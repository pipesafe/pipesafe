# Typia Error-DX Audit

## Metadata

- **Library:** Typia (samchon/typia) v4.x
- **Repository:** https://github.com/samchon/typia
- **Audit Date:** 2026-05-05
- **Classification:** TypeScript Transformer-based Validation
- **Key Characteristic:** Typia is a compile-time code generator (transformer) that emits validation code, not a pure type-level system like ArkType.

---

## Search-Hit Summary

| Pattern                                       | Count | Files                                                       |
| --------------------------------------------- | ----- | ----------------------------------------------------------- |
| `Error<`, `Invalid_`, `Mismatch`, etc.        | 4     | TypeGuardError, IJsonParseResult, IResult, TransformerError |
| `__brand`, `__tag`, `__type`, `unique symbol` | ~20   | TagBase.ts, IMetadataTypeTag.ts, tags/\*                    |
| `[never,`, `, never]`, `: never &`            | ~5    | OmitNever.ts, Resolved.ts, constraint patterns              |
| `extends \``, template-literal parsing        | ~15   | Format.ts, tags/Pattern.ts, CamelCase.ts                    |
| `@deprecated`, `@hidden`, `@internal`         | ~150+ | Scattered throughout module.ts, functional.ts, etc.         |
| `Prettify`, `Simplify`, `Compute`, `Expand`   | 0     | Not found in codebase                                       |

---

## Techniques Found

### Technique 1: Phantom Property Branding for Tag Metadata (T11)

**Category:** T11 - Symbol-Based Tracking

**File:** `/tmp/audit-libs/typia/packages/interface/src/tags/TagBase.ts`

**Code Snippet:**

```typescript
export type TagBase<
  Props extends TagBase.IProps<any, any, any, any, any, any>,
> = {
  "typia.tag"?: Props;
};
```

**Trigger:** When applying constraints like `string & MinLength<5>` or `number & Minimum<0>`.

**Error Message:** None at type level; the transformer reads `typia.tag` metadata at compile time and either (a) passes validation or (b) transformer emits diagnostic on unsupported constraints.

**Applicability:** HIGH for pipesafe. This is how Typia encodes all validation constraints (`Format<"email">`, `Pattern<>`, `Minimum<>`, etc.) using a phantom property pattern. The `typia.tag` key carries metadata that the transformer extracts during compilation. While **not a type-level error**, it demonstrates the branded-metadata approach for attaching constraints to types without runtime overhead.

---

### Technique 2: Phantom Property for Type Narrowing (T11)

**Category:** T11 - Symbol-Based Tracking

**File:** `/tmp/audit-libs/typia/packages/typia/src/TypeGuardError.ts` (lines 58-65)

**Code Snippet:**

```typescript
/**
 * Phantom property for TypeScript type safety.
 *
 * Not used at runtime—exists only to preserve generic type `T` in the type
 * system. Always `undefined`.
 *
 * @internal
 */
protected readonly fake_expected_typed_value_?: T | undefined;
```

**Trigger:** When catching `TypeGuardError` in a try-catch block or when using error constructors with generic `<T>`.

**Error Message:** The `expected: string` field on the error object describes the type that failed (e.g., `"number & ExclusiveMinimum<19>"`).

**Applicability:** HIGH for pipesafe. This technique preserves the generic type `T` through error objects, allowing downstream code to reason about what type was expected. The phantom property (`fake_expected_typed_value_?: T`) has no runtime presence but forces TypeScript to narrow the generic when destructuring or inspecting the error.

---

### Technique 3: Discriminated Union Results (T1 variant)

**Category:** T1 - Typed Error Returns (discriminated union shape)

**File:** `/tmp/audit-libs/typia/packages/interface/src/schema/IValidation.ts`

**Code Snippet:**

```typescript
export type IValidation<T = unknown> =
  | IValidation.ISuccess<T>
  | IValidation.IFailure;

export namespace IValidation {
  export interface ISuccess<T = unknown> {
    success: true;
    data: T;
  }

  export interface IFailure {
    success: false;
    data: unknown;
    errors: IError[];
  }
}
```

**Trigger:** When calling `typia.validate<T>(input)`, which returns `IValidation<T>` instead of throwing.

**Error Message:** Each `IError` contains `{ path: string, expected: string, value: unknown, description?: string }`. Detailed positional and type information is collected in the `errors` array.

**Applicability:** VERY HIGH for pipesafe. This discriminated union pattern allows exhaustive type narrowing (`if (result.success) { ... } else { result.errors.forEach(...) }`). Unlike `IResult<T, E>` which is generic, `IValidation<T>` hard-codes the error type as an array of structured errors. This enables better IDE autocomplete and natural error accumulation (not short-circuit).

---

### Technique 4: Tagged Result Union with Partial Data (partial recovery)

**Category:** T1 - Typed Error Returns (partial success variant)

**File:** `/tmp/audit-libs/typia/packages/interface/src/schema/IJsonParseResult.ts`

**Code Snippet:**

```typescript
export type IJsonParseResult<T = unknown> =
  | IJsonParseResult.ISuccess<T>
  | IJsonParseResult.IFailure<T>;

export namespace IJsonParseResult {
  export interface IFailure<T = unknown> {
    success: false;
    data: DeepPartial<T> | undefined; // Partial recovery
    input: string;
    errors: IError[];
  }
}
```

**Trigger:** When parsing lenient/malformed JSON via Typia's JSON parser, which attempts recovery.

**Error Message:** `IError[]` array with `{ path, expected, description }` for each parsing issue encountered.

**Applicability:** MEDIUM for pipesafe. The `DeepPartial<T>` type on failure indicates partial successful parsing. Pipesafe could use this for pipeline construction where some stages partially succeed (e.g., partial field resolution in group operations).

---

### Technique 5: Constraint Validation via Phantom Metadata (Transformer-Driven, T14 variant)

**Category:** T14 - Generic Context Binding (constraint validation)

**File:** `/tmp/audit-libs/typia/packages/interface/src/metadata/IMetadataTypeTag.ts`

**Code Snippet:**

```typescript
export interface IMetadataTypeTag {
  target: "boolean" | "bigint" | "number" | "string" | "array" | "object";
  kind: string;
  exclusive: boolean | string[];
  value?: any;
  validate?: string | undefined;
  schema?: object | undefined;
  /** @internal */
  predicate?: (input: ts.Expression) => ts.Expression;
}
```

**Trigger:** When applying mutually exclusive tags (e.g., both `Minimum<5>` and `ExclusiveMinimum<5>` on the same property).

**Error Message:** Transformer emits a compile-time diagnostic (e.g., `"Exclusive tags 'minimum' and 'exclusiveMinimum' cannot both be applied"`).

**Applicability:** HIGH for pipesafe. The `exclusive` field encodes constraint compatibility as metadata, allowing the transformer to detect invalid tag combinations at compile time rather than runtime. Pipesafe could use this for pipeline stage constraints (e.g., forbid certain $group keys with certain $match conditions).

---

### Technique 6: Assertion Guards with Type Narrowing (T4 variant)

**Category:** T4 - Conditional Return-Type Degradation + T5 - Overload Ladders

**File:** `/tmp/audit-libs/typia/packages/typia/src/module.ts` (lines 115-147)

**Code Snippet:**

```typescript
export function assertGuard<T>(
  input: T,
  errorFactory?: undefined | ((props: TypeGuardError.IProps) => Error)
): asserts input is T;

export function assertGuard<T>(
  input: unknown,
  errorFactory?: undefined | ((props: TypeGuardError.IProps) => Error)
): asserts input is T;

/** @internal */
export function assertGuard(): never {
  NoTransformConfigurationError("assertGuard");
}
```

**Trigger:** After calling `typia.assertGuard<T>(input)` without exception, TypeScript narrows `input` to type `T` in subsequent code.

**Error Message:** Throws `TypeGuardError` with `{ method, path, expected, value, description }` on failure.

**Applicability:** HIGH for pipesafe. The `asserts input is T` return type is a TypeScript language feature that narrows types without returning a value. Combined with overload ladders (`input: T` vs. `input: unknown` overloads), this pattern provides both compile-time type safety and runtime validation with clear error boundaries.

---

## Negative Results

- **No ZeroWidthSpace or sentinel-based error detection:** Unlike ArkType, Typia does not use special Unicode markers (U+200B) to tag error types. Typia's error system relies on the transformer's compile-time diagnostics, not phantom type markers.
- **No state-machine DSL parsing at type level:** Typia does not have a type-level equivalent to ArkType's `StaticState` machine. All DSL parsing happens at runtime in the transformer or in string utilities.
- **No `show<T>` utility for hover flattening:** Typia does not use mapped types to prettify intersection/union hovers. The type system is simpler and relies on the transformer's error messages.
- **No explicit `ErrorMessage<>` or `ErrorType<>` types:** Error reporting in Typia is entirely transformer-generated (via TypeScript diagnostics) or runtime-thrown (TypeGuardError).

---

## Cross-References

### Within Typia

- **AssertionGuard type** (`/tmp/audit-libs/typia/packages/interface/src/typings/AssertionGuard.ts`): Defines `(input: unknown) => asserts input is T`.
- **TagBase system** (`/tmp/audit-libs/typia/packages/interface/src/tags/`): All constraint tags (Format, Minimum, MaxLength, etc.) extend TagBase and use the `typia.tag` phantom property.
- **IValidation / IResult / IJsonParseResult**: Three distinct error union shapes for different validation scenarios.
- **TransformerError** (`/tmp/audit-libs/typia/packages/transform/src/TransformerError.ts`): Compile-time error reporting (code enum, structured messages).

### Applicability to Pipesafe

- **Pipeline constraint encoding**: Use `typia.tag` phantom pattern for encoding stage constraints (e.g., `$match` stage requiring non-null filters).
- **Validation result unions**: Adopt discriminated unions for pipeline construction results (success vs. partial recovery vs. failure).
- **Type narrowing in stage methods**: Use `asserts input is T` pattern for staged pipeline builders (e.g., `stageX<T>(input): asserts input is ValidatedT`).

---

## Summary

Typia's error DX is **transformer-driven**, not type-level. Key techniques:

1. **Phantom Branding** (T11): `"typia.tag"?: Props` carries constraint metadata that the transformer reads and validates at compile time.
2. **Discriminated Error Unions** (T1): `IValidation<T>`, `IResult<T, E>`, and `IJsonParseResult<T>` provide exhaustive type narrowing and error accumulation.
3. **Assertion Guards** (T4/T5): `asserts input is T` with overload ladders for type narrowing without return values.
4. **Constraint Metadata** (T14): `IMetadataTypeTag` encodes exclusivity rules for mutually incompatible constraints.

**Critical insight**: Typia's errors are **not encoded in the type system itself** but rather _emitted by the transformer_ during compilation. There is no ArkType-style `ErrorMessage<>` type. Instead, errors manifest as:

- Transformer diagnostics (compile-time, shown in IDE)
- Thrown `TypeGuardError` instances (runtime, detailed path/expected/value)
- Structured error arrays in result unions (semantic, accumulation-friendly)

Pipesafe should prioritize **discriminated error unions** for pipeline result types and **phantom metadata branding** for stage constraints, as these require no transformer and map directly to pure TypeScript.

---

**Applicability Scoring:**

- T1 (Discriminated unions): 9/10 (core validation pattern)
- T4 (Type narrowing guards): 8/10 (assertion-based API)
- T11 (Phantom branding): 7/10 (constraint metadata)
- T14 (Constraint exclusivity): 6/10 (specialized for tags)
