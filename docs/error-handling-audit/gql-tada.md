# Type-Level Error-DX Audit: gql.tada

**Library**: @0no-co/gql.tada (GraphQL parsing & type inference at compile-time)  
**Scope**: src/ (2,205 LoC)  
**Date**: 2026-05-05

---

## Executive Summary

gql.tada implements **compile-time GraphQL parsing** via a type-level tokenizer and recursive descent parser. Its error DX is distinct from ArkType: rather than embedding error messages in types, gql.tada achieves error detection through **constraint-side validation** (`never` returns) and **inference-based filtering**. No explicit error types are returned; invalid inputs are rejected via `never` short-circuit semantics or by returning `void`.

**Token budget: ~80k / 200k**

---

## Error Patterns Found

### P1: Parsing via Exhaustive Template-Literal State Machine (T8 analogue)

**File**: `src/tokenizer.ts` (142 lines)

gql.tada's tokenizer is a **type-level finite automaton** that consumes a GraphQL string character-by-character:

```typescript
type tokenizeRec<State> =
  State extends _state<'', any>  // Recursion base: empty input
    ? State['out']
  : State extends _state<infer In, infer Out>
    ? tokenizeRec<
        In extends `#${string}` ? _state<skipIgnored<In>, Out>  // Skip comments
        : In extends `...${infer In}` ? _state<In, [...Out, Token.Spread]>
        : In extends `!${infer In}` ? _state<In, [...Out, Token.Exclam]>
        : ...  // 30+ pattern branches
        : void  // No match = invalid
      >
    : [];
```

**Error mechanism**: When no pattern matches, the type returns `void`, which propagates as a constraint violation:

```typescript
export type tokenize<In extends string> = tokenizeRec<_state<In, []>>;
// Invalid input → tokenizeRec returns void → propagates
```

**Classification**: **T8 (String DSL Parser)** with **T3 (State Machine)** elements. Lexically sound but produces no diagnostic messages—errors are silent constraint failures.

---

### P2: Recursive-Descent Parser with `void` Short-Circuit (T4/T6)

**File**: `src/parser.ts` (379 lines)

The parser builds on tokenized input:

```typescript
type takeValue<In extends any[], Const extends boolean> =
  In extends [Token.Float, ...infer In] ? _match<{ kind: Kind.FLOAT }, In>
  : In extends [Token.Integer, ...infer In] ? _match<{ kind: Kind.INT }, In>
  : Const extends false
    ? In extends [{ kind: Token.Var, name: infer Name }, ...infer In]
      ? _match<{ kind: Kind.VARIABLE; ... }, In>
      : void  // Invalid value in variable context
    : void;  // Constants cannot contain variables
```

**Error mechanism**: Failed branches return `void`, triggering downstream constraint failures:

```typescript
export type parseDocument<In extends string> =
  _takeDocumentRec<[], tokenize<In>> extends (
    _match<[...infer Definitions], any>
  ) ?
    Definitions extends [] ?
      never // No definitions parsed
    : { kind: Kind.DOCUMENT; definitions: Definitions }
  : never; // Parser failed entirely
```

**Key insight**: When `tokenize<In>` returns `void` or parser returns `void`, the type cascades to `never` at the call site, blocking invalid queries completely.

**Classification**: **T6 (Constraint-Side Validation)** + **T4 (Conditional Degradation)**. Error is implicit: invalid input simply fails to type-check.

---

### P3: Fragment Masking via Unique Symbols (T11 analogue)

**File**: `src/namespace.ts` (131 lines)

Fragment isolation uses branded phantom symbols:

```typescript
declare namespace $tada {
  const fragmentRefs: unique symbol;
  export type fragmentRefs = typeof fragmentRefs;

  const ref: unique symbol;
  export type ref = typeof ref;
}

type makeFragmentRef<Document> =
  Document extends FragmentShape<infer Definition, infer Result> ?
    Definition["masked"] extends false ?
      Result
    : {
        [$tada.fragmentRefs]: {
          [Name in Definition["fragment"]]: Definition["on"];
        };
      }
  : never;
```

**Error mechanism**: If a fragment is referenced but not defined in the document, `getFragmentsOfDocuments<Fragments>` returns an object missing that key, causing downstream field access to fail:

```typescript
// In selection.ts line 100-113
Fragments[Node['name']['value']] extends { [$tada.ref]: any }
  ? ...  // Success
  : never  // Fragment not found
```

**Classification**: **T11 (Symbol-Based Tracking)**. The `unique symbol` acts as a phantom tag that cannot be constructed or compared by users, ensuring fragment identity.

---

### P4: Bidirectional Type Unwrapping (T7 analogue)

**File**: `src/variables.ts` (135 lines) and `src/selection.ts` (294 lines)

Type unwrapping validates schema introspection against parsed documents:

```typescript
type unwrapTypeRec<TypeRef, Introspection extends SchemaLike, IsOptional> =
  TypeRef extends { kind: "NON_NULL"; ofType: any } ?
    unwrapTypeRec<TypeRef["ofType"], Introspection, false>
  : TypeRef extends { kind: "LIST"; ofType: any } ?
    IsOptional extends false ?
      Array<unwrapTypeRec<TypeRef["ofType"], Introspection, true>>
    : null | Array<unwrapTypeRec<TypeRef["ofType"], Introspection, true>>
  : TypeRef extends { name: any } ?
    IsOptional extends false ?
      getScalarType<TypeRef["name"], Introspection>
    : null | getScalarType<TypeRef["name"], Introspection>
  : unknown; // Fallback for unrecognized types
```

If `getScalarType<TypeRef['name'], Introspection>` finds no matching type in the introspection:

```typescript
type getScalarType<TypeName, Introspection extends SchemaLike> =
  TypeName extends keyof Introspection['types']
    ? ...
    : never;  // Unknown type name
```

**Classification**: **T7 (Inference Capture)**. The `infer` extracts the `name`, then immediate lookup validates it exists.

---

### P5: Overload-Based Type Narrowing (T5 analogue)

**File**: `src/api.ts` (783 lines)

The `graphql()` function uses overloads to discriminate between cache hit and parse:

```typescript
<
  const In extends unknown extends setupCache['__cacheDisabled'] ? keyof setupCache : never,
  const Fragments extends readonly FragmentShape[],
>(
  input: In,
  fragments?: Fragments
): setupCache[In];

// Cache miss overload
<const In extends string, const Fragments extends readonly FragmentShape[]>(
  input: In,
  fragments?: Fragments
): getDocumentNode<
  parseDocument<In>,
  Schema,
  getFragmentsOfDocuments<Fragments>,
  Config['isMaskingDisabled']
>;
```

If `parseDocument<In>` is `never`, then `getDocumentNode<never, ...>` returns `never`, and the call is rejected.

**Classification**: **T5 (Overload Ladders)**. The first overload requires a cache key; if absent, TypeScript tries the second, which may fail parsing.

---

### P6: Utility Type Flattening (`obj<T>`)

**File**: `src/utils.ts` (81 lines)

The `obj<T>` utility forces object intersection normalization:

```typescript
export type obj<T> =
  T extends { [key: string | number]: any } ? { [K in keyof T]: T[K] } : never;
```

This is used to flatten complex intersection results in selection sets (e.g., `selection.ts:237`):

```typescript
: SelectionAcc['rest'] extends infer T
  ? obj<SelectionAcc['fields'] & T>
  : never;
```

**Classification**: **T10 (Hover-Flattening)** analogue. Improves IDE readability by forcing intersection normalization.

---

## Search Results Summary

| Pattern                     | Count | Files                                         |
| --------------------------- | ----- | --------------------------------------------- |
| `never` returns             | 30+   | parser.ts, selection.ts, variables.ts, api.ts |
| `void` (constraint failure) | 20+   | tokenizer.ts, parser.ts                       |
| `infer` + constraint lookup | 15+   | selection.ts, variables.ts, introspection.ts  |
| Template-literal parsing    | 50+   | tokenizer.ts, parser.ts                       |
| `extends` conditionals      | 100+  | selection.ts, variables.ts, namespace.ts      |
| Unique symbols              | 3     | namespace.ts                                  |

---

## Top Techniques Relevant to Pipesafe

### 1. **Type-Level Recursive Descent Parser (P2)**

gql.tada's `takeValue`, `takeSelectionSet`, `takeOperationDefinition` chain is directly analogous to pipesafe's `fieldReference.ts`. When parsing `"$field.nested.path"`:

- **Advantage**: Exhaustive pattern matching (`In extends [Token.Name, ...]`) ensures all valid inputs are caught.
- **Drawback**: No positional error messages; errors are silent `never` returns.
- **Applicability**: HIGH—pipesafe can adopt the same state-threading pattern but should add error context via T2 (positional messages in template literals).

### 2. **Constraint-Side Validation via `never` (P2, P4)**

When a field doesn't exist in the schema:

```typescript
Type["fields"][Node["name"]["value"]]; // If field missing → undefined → never
```

This is cleaner than wrapping in `ErrorType<...>` because it's automatic. However, the IDE error message is generic ("Type 'undefined' is not assignable to type X").

- **Applicability**: MEDIUM—good for compile-time rejection, but IDE feedback is minimal.

### 3. **Bidirectional Schema Validation (P4)**

The pattern in `getScalarType<TypeName, Introspection>` validates that a type exists in the schema. Pipesafe can use this for validating pipeline operators against allowed operations on field types (e.g., `$gt` only on numeric/date fields).

- **Applicability**: HIGH—directly transferable to match.ts, set.ts, group.ts operators.

### 4. **State Threading with Disambiguation (P1, P2)**

gql.tada threads state through a `_state` interface:

```typescript
interface _state<In extends string, Out extends TokenNode[]> {
  out: Out;
  in: In;
}
```

This ensures the input (`in`) is consumed incrementally and prevents backtracking ambiguity.

- **Applicability**: MEDIUM—pipesafe could adopt this for Pipeline type narrowing, though current `match.ts` union-based approach is simpler.

### 5. **Overload Escalation for Arity (P5)**

Multiple function overloads with increasing parameter counts are a standard DX pattern in gql.tada's `graphql()` function.

- **Applicability**: LOW for pipesafe—not directly applicable since pipeline operations have fixed arities.

---

## Gaps & Recommendations

1. **No Explicit Error Messages**: gql.tada relies entirely on `never` short-circuit semantics. When a query is malformed, TypeScript shows "Type 'void' is not assignable to type 'never'" rather than "Expected field name after `.`".
   - **Recommendation**: Add T2 (Template-Literal Positional Errors) to pipesafe's fieldReference parser to surface position and context.

2. **No Error Accumulation**: All parsing is short-circuit; a single invalid token halts parsing.
   - **Recommendation**: Keep short-circuit for IDE responsiveness (follows ArkType precedent), but document the limitation.

3. **Introspection Coupling**: Schema validation happens post-parse. A typo in a field name is caught late.
   - **Recommendation**: Consider ahead-of-time schema validation in pipesafe's Pipeline class to fail faster.

4. **Limited IDE Completion**: Because errors are `never` returns, IDE autocomplete doesn't offer corrections.
   - **Recommendation**: Use phantom-parameter messages (T9) to guide users toward valid field names in error tooltips.

---

## Conclusion

gql.tada's error DX is **silent and minimal but effective**. It prioritizes correctness via type constraints over user-facing diagnostics. Its state machines (tokenizer, parser) are the most sophisticated aspect and directly applicable to pipesafe's string-DSL parsing.

**Recommended adoption for pipesafe**:

1. **Recursive descent parser architecture** (P2) for fieldReference and Pipeline validation
2. **Bidirectional schema introspection** (P4) for operator type-checking
3. **Phantom symbol tracking** (P3) for pipeline stage isolation
4. **Template-literal positional errors** (T2, missing in gql.tada) for better IDE messages

---

**Audit completion**: 2026-05-05  
**Next audit**: check `tsconfigs` setup patterns from gql.tada test suite if needed.
