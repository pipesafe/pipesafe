# Type-Level Error-DX Taxonomy: ArkType Analysis

## Overview

A **type-level error DX technique** is a TypeScript pattern that encodes validation errors, malformed input detection, or constraint violations into the type system itself. These techniques surface at compile-time in IDEs (via hover tooltips and diagnostics) and in error messages, allowing users to catch mistakes before runtime. They range from tuple branding and phantom parameters to intricate state machines that parse type strings and accumulate positional error information.

---

## Categories

### T1: Typed Error Returns (`ErrorMessage` / `ErrorType`)

**Name:** Typed Error Returns

**Definition:** A type-level error that is itself returned as the inferred/validated type (e.g., `type.validate<def>` returns `ErrorMessage<msg>` instead of a valid type).

**Example (ArkType):**
```typescript
// ark/util/errors.ts:41-42
export type ErrorMessage<message extends string = string> =
  `${message}${ZeroWidthSpace}`

// ark/type/parser/ast/validate.ts:35-38
export type validateAst<ast, $, args> =
  ast extends ErrorMessage ? ast
  : ast extends InferredAst ? validateInferredAst<ast[0], ast[2]>
  : ...
```

**Observable Effect:** Shows in hover as the error message itself; IDE autocomplete is suppressed; TS reports "type X is not assignable to type Y" where Y is the true expected type.

**Tags:** [hover-only, diagnostic-only], [low-perf-cost], [no]

**Notes:** ArkType uses `ZeroWidthSpace` (U+200B) as a sentinel to mark error strings so they don't collide with valid type strings.

---

### T2: Template-Literal Error Messages with Position Info

**Name:** Template-Literal Positional Errors

**Definition:** Error messages embedded in template literals that capture position or context from the parsed string (e.g., `"Expected X at position 5 in 'string|numbr'"`).

**Example (ArkType):**
```typescript
// ark/type/parser/shift/operator/operator.ts
export const writeUnexpectedCharacterMessage = <s extends string>(
  s: s
): writeUnexpectedCharacterMessage<s> =>
  `Unexpected character '${s}'`

// ark/type/parser/string.ts:37, 85
if (s.finalizer === ">") throwParseError(writeUnexpectedCharacterMessage(">"))
...
throwParseError(writeUnexpectedCharacterMessage(s.scanner.lookahead))
```

**Observable Effect:** Error tooltip shows exact character or symbol that failed; hovers show the scanned vs. unscanned portions of the input string in the state machine.

**Tags:** [hover-only, diagnostic-only], [medium], [requires-template-literals]

**Notes:** Complements static state machine validation with runtime context capture for better diagnostics.

---

### T3: State Machine with Finalizer Slot

**Name:** State-Machine Error Finalization

**Definition:** A type-state machine that threads an `ErrorMessage` through a `finalizer` slot, allowing any parse branch to short-circuit with a detailed error while preserving machine state.

**Example (ArkType):**
```typescript
// ark/type/parser/reduce/static.ts:23-30
export type StaticState = {
  root: unknown
  branches: BranchState
  groups: BranchState[]
  finalizer: FinalizingLookahead | ErrorMessage | undefined
  scanned: string
  unscanned: string
}

// ark/type/parser/reduce/static.ts:52-59
export type s.error<message extends string> = from<{
  root: ErrorMessage<message>
  branches: initialBranches
  groups: []
  finalizer: ErrorMessage<message>
  scanned: ""
  unscanned: ""
}>
```

**Observable Effect:** Entire parse halts; error propagates cleanly to `validateString` which returns it unchanged; IDE shows full error context.

**Tags:** [hover-only, diagnostic-only], [low-perf-cost], [no]

**Notes:** This is ArkType's core strategy for string-DSL parsing. The `finalizer` is checked at the end via `extractFinalizedResult`.

---

### T4: Conditional Return-Type Degradation

**Name:** Conditional Degradation (Never / Unknown / Error)

**Definition:** A function or type that returns a valid type or `ErrorType<...>` based on a predicate; invalid inputs are wrapped in `ErrorType` which blocks further operations.

**Example (ArkType):**
```typescript
// ark/type/variants/object.ts:99-104
merge<
  const def,
  inferredDef = type.infer<def, $>,
  r = Type<merge<t, inferredDef>, $>
>(
  def: type.validate<def, $> &
    (inferredDef extends object ? unknown
    : ErrorType<[NonObjectMergeErrorMessage, actual: inferredDef]>)
): r extends infer _ ? _ : never

// ark/type/variants/object.ts:222
export type NonObjectMergeErrorMessage = "Merged type must be an object"
```

**Observable Effect:** When user hovers over the method parameter, IDE shows `& (false ? unknown : ErrorType<...>)` intersection, suppressing autocomplete and signaling a type error.

**Tags:** [hover-only], [medium], [no]

**Notes:** `ErrorType` is a branded interface in `@ark/util` that communicates "this branch is invalid" to type checkers.

---

### T5: Overload Ladders with Type Inference Recovery

**Name:** Overload Ladders with `r extends infer _ ? _ : never`

**Definition:** Function overloads for multiple arities where each overload has a default parameter `r` computing the result, and the return type uses `r extends infer _ ? _ : never` to force type instantiation and error propagation.

**Example (ArkType):**
```typescript
// ark/type/nary.ts:19-25
<const a, r = Type<type.infer<a, $>, $>>(
  a: type.validate<a, $>
): r extends infer _ ? _ : never
<const a, const b, r = Type<type.infer<a, $> | type.infer<b, $>, $>>(
  a: type.validate<a, $>,
  b: type.validate<b, $>
): r extends infer _ ? _ : never
```

**Observable Effect:** If `type.validate<a, $>` returns an error, the return type also returns that error; `r extends infer _ ? _ : never` forces full evaluation. Overloads escalate arity, improving IDE autocomplete.

**Tags:** [hover-only, diagnostic-only], [low-perf-cost], [no]

**Notes:** This technique is essential for good error propagation in nary functions; ArkType uses it extensively for union/intersection builders.

---

### T6: Constraint-Side Validation (extends clauses)

**Name:** Constraint Validation

**Definition:** Type validation happens in generic constraints (e.g., `<T extends Constraint>`) or intersection constraints, rejecting invalid types at instantiation time.

**Example (ArkType):**
```typescript
// ark/type/declare.ts:48-51
export type validateDeclared<declared, def, $, ctx extends DeclareContext> =
  def extends type.validate<def, $> ?
    validateInference<def, declared, $, bindThis<def>, ctx>
  : type.validate<def, $>
```

**Observable Effect:** When constraint fails, IDE shows "type X is not assignable to type Constraint" with a concise error message; the constraint violation IS the error.

**Tags:** [diagnostic-only], [low-perf-cost], [no]

**Notes:** ArkType uses this extensively for validating that parsed definitions match their declared types.

---

### T7: Inference Capture and Mismatch Detection

**Name:** Inference Capture via `infer`

**Definition:** A type extracts and validates a candidate type via `infer`, then compares it against expected constraints using `equals<inferred, declared>` to detect mismatches.

**Example (ArkType):**
```typescript
// ark/type/declare.ts:122-129
type validateShallowInference<
  t,
  declared,
  ctx extends DeclareContext,
  inferred = ctx["side"] extends distill.Side ? distill<t, ctx["side"]> : t
> =
  equals<inferred, declared> extends true ? unknown
  : show<declarationMismatch<inferred, declared>>
```

**Observable Effect:** If inferred and declared types don't match, `declarationMismatch<inferred, declared>` returns an `ErrorType` with both sides exposed, helping developers debug type misalignments.

**Tags:** [hover-only], [medium], [no]

**Notes:** Used in `declare<ExternalType>()` to validate that user-provided types match ArkType's inference.

---

### T8: String DSL Parser with Scanner State Machine

**Name:** String DSL Shallow Parsing

**Definition:** A runtime string parser that also has a compile-time type-state machine, capturing both parse result and error position/context at the type level.

**Example (ArkType):**
```typescript
// ark/type/parser/string.ts:21-40
export const parseString = (
  def: string,
  ctx: BaseParseContext
): InnerParseResult => {
  const aliasResolution = ctx.$.maybeResolveRoot(def)
  if (aliasResolution) return aliasResolution
  
  const s = new RuntimeState(new Scanner(def), ctx)
  const node = fullStringParse(s)
  
  if (s.finalizer === ">") throwParseError(writeUnexpectedCharacterMessage(">"))
  return node
}

// Type-level: parseString<def, $, args> uses s.initialize and state transitions
export type parseString<def extends string, $, args> =
  def extends keyof $ ? resolutionToAst<def, $[def]>
  : def extends `${infer child}[]` ? ...
  : fullStringParse<s.initialize<def>, $, args>
```

**Observable Effect:** IDE shows which character failed to parse in a type string like `"string|numbr"`; hovers reveal scanner position and remaining input; completion suggestions respect context (e.g., after `|` only union-compatible types).

**Tags:** [hover-only, diagnostic-only], [high], [requires-template-literals]

**Notes:** ArkType's centerpiece for user-facing DX. The `Scanner` class tokenizes at runtime; the `StaticState` mirrors this at compile-time for validation.

---

### T9: Overload Message Injection via Parameter Constraint

**Name:** Phantom-Parameter Error Messages

**Definition:** A function parameter includes an intersection with a conditional error message, which is invisible if valid but shows in diagnostics if the condition fails.

**Example (ArkType):**
```typescript
// ark/type/parser/definition.ts:164-172
export type validateDefinition<def, $, args> =
  null extends undefined ?
    ErrorMessage<`'strict' or 'strictNullChecks' must be set to true in your tsconfig's 'compilerOptions'`>
  : [def] extends [anyOrNever] ? def
  : def extends OptionalPropertyDefinition ?
    ErrorMessage<shallowOptionalMessage>
  : isDefaultable<def, $, args> extends true ?
    ErrorMessage<shallowDefaultableMessage>
  : validateInnerDefinition<def, $, args>

// ark/type/parser/ast/validate.ts:116-124
export const shallowOptionalMessage =
  "Optional definitions like 'string?' are only valid as properties in an object or tuple"
```

**Observable Effect:** If user writes `type("string?")` at the top level, IDE shows "Optional definitions... are only valid as properties" in the error tooltip.

**Tags:** [diagnostic-only], [low-perf-cost], [requires-template-literals]

**Notes:** Context-specific errors that guide users toward valid syntax alternatives.

---

### T10: Hover-Flattening via `show<T>`

**Name:** Display Prettification

**Definition:** A utility type `show<T>` that forces intersection and union normalizations to display flattened in hover tooltips, making errors easier to read.

**Example (ArkType):**
```typescript
// ark/util/generics.ts:13-14
/** Force an operation like `{ a: 0 } & { b: 1 }` to be computed so that it displays `{ a: 0; b: 1 }`. */
export type show<t> = { [k in keyof t]: t[k] } & unknown

// ark/type/declare.ts:85-96
type validateObjectInference<
  def extends object,
  declared,
  $,
  args,
  ctx extends DeclareContext
> = show<
  {
    [k in requiredKeyOf<declared>]: k extends keyof def ?
      validateInference<def[k], declared[k], $, args, ctx>
    : declared[k]
  } & { ... }
>
```

**Observable Effect:** Hovers on error types show `{ declared: X; inferred: Y }` instead of the raw intersection, making side-by-side comparison easier.

**Tags:** [hover-only], [low-perf-cost], [no]

**Notes:** Essential for readability of complex error types; ArkType uses it liberally for `declarationMismatch` and object validation errors.

---

### T11: Branded/Phantom Symbols for Tracking

**Name:** Symbol-Based Tracking

**Definition:** A type uses `unique symbol` or a branded key (e.g., `[brand]`) to attach metadata that does not affect runtime but signals type-level state or ownership.

**Example (ArkType):**
```typescript
// ark/type/keywords/keywords.ts:107-110
export declare namespace type {
  export interface cast<to> {
    [inferred]?: to
  }
}

// ark/util/generics.ts:69-73
export const brand = noSuggest("brand")

export type Brand<t = unknown, id = unknown> = t & {
  readonly [brand]: [t, id]
}
```

**Observable Effect:** Type is "tagged" in the type system but has no runtime effect; when a branded type is returned, IDEs can see that it originated from a specific operation.

**Tags:** [hover-only], [low-perf-cost], [no]

**Notes:** Used in ArkType to distinguish valid `Type<T>` from erroneous `ErrorType<{...}>`.

---

### T12: JSDoc Deprecation Markers

**Name:** JSDoc Warnings

**Definition:** `@deprecated` and `@hidden` JSDoc annotations on type variants or deprecated overloads to guide users away from old APIs.

**Example (ArkType):**
```typescript
// ark/type/variants/base.ts (multiple entries)
/** @deprecated */
export interface Type<out t = unknown, $ = {}> { ... }
```

**Observable Effect:** IDE shows strikethrough and deprecation warning in autocomplete; hover shows deprecation notice; warning in build output.

**Tags:** [hover-only, diagnostic-only], [low-perf-cost], [no]

**Notes:** Soft migration path for breaking changes; ArkType marks older function signatures with `@deprecated`.

---

### T13: Error Accumulation vs. Short-Circuit

**Name:** Error Accumulation Strategy

**Definition:** A choice between returning the first error encountered (short-circuit) or collecting all errors in an accumulator structure. ArkType favors short-circuit for simplicity.

**Example (ArkType):**
```typescript
// ark/type/parser/reduce/dynamic.ts short-circuits on first error
export const parseUntilFinalizer = (s: RuntimeState): RootedRuntimeState => {
  while (s.finalizer === undefined) next(s)
  return s as RootedRuntimeState
}

// Validation stops at first ErrorMessage
type validateInfix<ast extends InfixExpression, $, args> =
  validateAst<ast[0], $, args> extends infer e extends ErrorMessage ? e
  : validateAst<ast[2], $, args> extends infer e extends ErrorMessage ? e
  : undefined
```

**Observable Effect:** IDE shows only the first blocking error; user must fix it to see next error (sequential error discovery).

**Tags:** [hover-only, diagnostic-only], [medium], [no]

**Notes:** ArkType's design prioritizes IDE responsiveness over exhaustive error lists.

---

### T14: Generic Context Binding and Resolution Errors

**Name:** Generic Context Binding

**Definition:** A type validates that generic arguments can be bound to generic parameters, with detailed errors if binding fails (e.g., too many/few arguments, type mismatch).

**Example (ArkType):**
```typescript
// ark/type/generic.ts (simplified)
parseGenericParams<extractParams<s>, $> extends infer e extends ErrorMessage ?
  e
: ...

// ark/type/parser/ast/validate.ts:60-61
: ast extends GenericInstantiationAst<infer g, infer argAsts> ?
  validateGenericInstantiation<g, argAsts, $, args>
```

**Observable Effect:** When user calls a generic type with wrong arg count, IDE shows "`T<X>` requires 2 arguments but got 1" style message.

**Tags:** [diagnostic-only], [medium], [no]

**Notes:** Validates the `Generic` trait system; errors guide proper instantiation.

---

### T15: Definition Mismatch via Object Destructuring

**Name:** Declaration Mismatch Objects

**Definition:** An error type that is an object with `declared` and `inferred` fields, allowing IDEs to compare side-by-side what the user claimed vs. what the type system inferred.

**Example (ArkType):**
```typescript
// ark/type/declare.ts:131-134
type declarationMismatch<inferred, declared> = ErrorType<{
  declared: declared
  inferred: inferred
}>
```

**Observable Effect:** Hover on a `declare<T>().type(def)` mismatch shows a two-field object revealing the gap (e.g., `{ declared: boolean; inferred: number | string }`).

**Tags:** [hover-only], [low-perf-cost], [no]

**Notes:** Helps developers debug why their manual type declarations don't match parsed inference.

---

## Summary Table

| ID  | Name | Hover | Diagnostic | Perf | TL | Notes |
|-----|------|-------|-----------|------|-----|-------|
| T1  | Typed Error Returns | ✓ | ✓ | Low | No | ZeroWidthSpace sentinel |
| T2  | Template-Literal Positional Errors | ✓ | ✓ | Med | Yes | Position/context captured |
| T3  | State Machine Error Finalization | ✓ | ✓ | Low | No | Finalizer slot threading |
| T4  | Conditional Degradation | ✓ | - | Med | No | ErrorType wrapping |
| T5  | Overload Ladders | ✓ | ✓ | Low | No | r extends infer _ trick |
| T6  | Constraint-Side Validation | - | ✓ | Low | No | Generic constraint errors |
| T7  | Inference Capture | ✓ | - | Med | No | equals<> mismatch detection |
| T8  | String DSL Parser | ✓ | ✓ | High | Yes | Scanner + StaticState |
| T9  | Phantom-Parameter Messages | - | ✓ | Low | Yes | Context-specific errors |
| T10 | Hover-Flattening | ✓ | - | Low | No | show<T> utility |
| T11 | Symbol-Based Tracking | ✓ | - | Low | No | brand / inferred keys |
| T12 | JSDoc Warnings | ✓ | ✓ | Low | No | @deprecated / @hidden |
| T13 | Error Accumulation | ✓ | ✓ | Med | No | Short-circuit strategy |
| T14 | Generic Context Binding | - | ✓ | Med | No | Generic arg validation |
| T15 | Declaration Mismatch Objects | ✓ | - | Low | No | declared vs inferred |

---

## Key Observations

1. **ArkType favors short-circuit errors** over error accumulation for IDE responsiveness.
2. **String DSL parsing is the heaviest DX investment**, using both runtime and compile-time state machines for rich positional errors.
3. **ZeroWidthSpace (U+200B) is a key sentinel** to distinguish error strings from valid type strings without collision.
4. **Overload ladders with `r extends infer _ ? _ : never`** are essential for type inference recovery and arity escalation.
5. **ErrorType<{...}> and ErrorMessage<>** provide distinct error shapes: `ErrorType` for method signature constraints, `ErrorMessage` for parse results.
6. **Constraint-side errors and phantom-parameter messages** guide users toward correct syntax without needing explicit documentation.
7. **show<T> and Brand<T, id>** are utility types that improve readability and type tracking at low performance cost.

