# viem Type-Level Error DX Audit

## Metadata

**Source:** `/tmp/audit-libs/viem/` (v21+)  
**Scope:** `src/types/`, `src/errors/`, `src/utils/abi/`, `src/utils/typedData/`  
**Excluded:** Tests, dist, documentation  
**Focus:** Type-level error DX in contract ABIs, typed data, and error handling  
**Dependencies:** `abitype` (external, provides template-literal ABI parsing)

---

## Search Hit Summary

| Pattern                                        | Count | Notes                                              |
| ---------------------------------------------- | ----- | -------------------------------------------------- |
| `Error<`, `Invalid_`, `Invalid<`               | 111   | Mainly branded error types & runtime error classes |
| `__error`, `__brand`, `__tag`, `unique symbol` | 1     | One `unique symbol` declaration for branding       |
| `[never,`, `, never]`, `: never &`             | 0     | No never-based sentinel errors                     |
| `extends \``, `Parse<`, `Tokenize<`            | 0     | No compile-time string parsing at type level       |
| `@deprecated`, `@hidden`, `@internal`          | 379   | Heavy use for API versioning and migration         |
| `Prettify`, `Simplify`, `Compute`              | 215   | Widespread use for type display flattening         |

---

## Techniques Found

### 1. **Branded Error Types via `unique symbol` and Type Intersections**

**Category:** T11 (Symbol-Based Tracking)  
**File:** `/tmp/audit-libs/viem/src/types/utils.ts:1-14`

**Snippet:**

```typescript
declare const symbol: unique symbol;

export type Branded<T, U> = T & { [symbol]: U };
```

**Trigger:**
Used to create phantom-branded types for error categorization without runtime overhead. Example:

```typescript
type AbiConstructorNotFoundErrorType = AbiConstructorNotFoundError & {
  name: "AbiConstructorNotFoundError";
};
```

**Applicability:** HIGH for pipesafe. Field references (`fieldReference.ts`) and aggregation stages could use branded types to distinguish valid references from error states without runtime cost.

---

### 2. **Generic Constraint-Side Type Narrowing with Ternary Fallbacks**

**Category:** T6 (Constraint Validation) + T7 (Inference Capture)  
**File:** `/tmp/audit-libs/viem/src/types/contract.ts:31-50`

**Snippet:**

```typescript
export type ContractFunctionName<
  abi extends Abi | readonly unknown[] = Abi,
  mutability extends AbiStateMutability = AbiStateMutability,
> =
  ExtractAbiFunctionNames<abi extends Abi ? abi : Abi, mutability> extends (
    infer functionName extends string
  ) ?
    [functionName] extends [never] ?
      string // fallback when no function names extracted
    : functionName
  : string;
```

**Trigger:**
When ABI has no matching functions for the given mutability filter, `ExtractAbiFunctionNames` returns `never`. The `[T] extends [never]` check triggers a fallback to `string`, allowing IDEs to suppress autocomplete gracefully.

**Error Message:** Implicit—no explicit error. Instead, type widens to `string` when constraint fails, signaling invalid input via reduced type precision.

**Applicability:** VERY HIGH. Match.ts (validating stage predicates) and group.ts (validating grouping fields) could use this pattern: if a field doesn't exist in the schema, narrow to `never` or widen to `unknown` with an error type wrapper.

---

### 3. **Display Prettification via Intersection Flattening**

**Category:** T10 (Hover-Flattening)  
**File:** `/tmp/audit-libs/viem/src/types/utils.ts:165-167`

**Snippet:**

```typescript
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
```

**Trigger:**
Applied recursively across `ContractFunctionArgs`, `MulticallContracts`, and `TypedDataDefinition`. Flatten nested intersections for cleaner IDE tooltips.

**Applicability:** HIGH. Pipeline.ts (final aggregation output types) and set.ts (computed field types) benefit from flattening complex intersections into readable objects.

---

### 4. **ErrorType<name extends string> — Nominal Error Tracking**

**Category:** T1 (Typed Error Returns)  
**File:** `/tmp/audit-libs/viem/src/errors/utils.ts:3`

**Snippet:**

```typescript
export type ErrorType<name extends string = "Error"> = Error & { name: name };
```

**Trigger:**
Generic constraint in function signatures (e.g., `getContractError<err extends ErrorType<string>>`). Communicates "this is an error object with a guaranteed `name` field" to static analysis.

**Observable Effect:** Functions like `getContractError`, `getCallError`, and `getTransactionError` enforce that callers provide typed error instances. IDE shows `Error & { name: string }` intersection, allowing error discrimination downstream.

**Applicability:** MEDIUM. Error handling in validation functions (match.ts, set.ts) could adopt `ValidationError<"InvalidField" | "TypeMismatch">` to narrow error cases.

---

### 5. **Runtime + Compile-Time Error Context via metaMessages**

**Category:** T2 (Template-Literal Positional Errors) hybrid approach  
**File:** `/tmp/audit-libs/viem/src/errors/abi.ts:80-96` (example: `AbiDecodingDataSizeTooSmallError`)

**Snippet:**

```typescript
export class AbiDecodingDataSizeTooSmallError extends BaseError {
  constructor({
    data,
    params,
    size,
  }: {
    data: Hex;
    params: readonly AbiParameter[];
    size: number;
  }) {
    super(
      [`Data size of ${size} bytes is too small for given parameters.`].join(
        "\n"
      ),
      {
        metaMessages: [
          `Params: (${formatAbiParams(params, { includeName: true })})`,
          `Data:   ${data} (${size} bytes)`,
        ],
        name: "AbiDecodingDataSizeTooSmallError",
      }
    );
    this.data = data;
    this.params = params;
    this.size = size;
  }
}
```

**Trigger:**
At runtime, construction includes contextual metadata (parameter names, actual data size). The `BaseError` type guarantees `metaMessages?: string[]` field for structured error output.

**Applicability:** MEDIUM. Pipeline validation errors in match.ts could attach inferred field type and position in the aggregation graph to aid debugging.

---

### 6. **Recursive Tuple Accumulation with Prettify (Calls, MulticallContracts)**

**Category:** T5 (Overload Ladders with Type Inference Recovery) variant  
**File:** `/tmp/audit-libs/viem/src/types/calls.ts:33-57`

**Snippet:**

```typescript
export type Calls<
  calls extends readonly unknown[],
  extraProperties extends Record<string, unknown> = {},
  result extends readonly any[] = [],
> =
  calls extends readonly [] ? readonly []
  : calls extends readonly [infer call] ?
    readonly [...result, Prettify<Call<call, extraProperties>>]
  : calls extends readonly [infer call, ...infer rest] ?
    Calls<
      [...rest],
      extraProperties,
      [...result, Prettify<Call<call, extraProperties>>]
    >
  : readonly unknown[] extends calls ? calls
  : calls extends (
    readonly (infer call extends OneOf<Call<unknown, extraProperties>>)[]
  ) ?
    readonly Prettify<call>[]
  : readonly OneOf<Call>[];
```

**Trigger:**
Recursively processes heterogeneous tuples. If input is truly unknown, falls back to homogenous inference. At each step, `Prettify` formats intersections for readability.

**Applicability:** VERY HIGH. Pipeline stages (set.ts, group.ts, match.ts) form a cumulative tuple of operations. Using this pattern with a `Stage<>` type would accumulate configuration and infer final pipeline shape.

---

### 7. **Conditional Constraint Degradation with Fallback Union**

**Category:** T4 (Conditional Degradation)  
**File:** `/tmp/audit-libs/viem/src/types/contract.ts:161-190` (CheckArgs + narrowing overloads)

**Snippet:**

```typescript
type CheckArgs<
  abiFunction extends AbiFunction,
  args,
  targetArgs extends AbiParametersToPrimitiveTypes<
    abiFunction["inputs"],
    "inputs",
    true
  > = AbiParametersToPrimitiveTypes<abiFunction["inputs"], "inputs", true>,
> =
  (readonly [] extends args ? readonly [] : args) extends targetArgs ?
    abiFunction
  : never;
```

**Trigger:**
When user-provided `args` do not match the ABI function's expected parameter types, returns `never` to remove that overload from the union. Remaining overloads suggest valid function matches.

**Applicability:** HIGH. Match predicates in match.ts could use similar type-level filtering: if a field reference doesn't exist in the schema, remove that predicate from the valid set.

---

## Negative Results

- **No T8 (String DSL Parser with Scanner State Machine):** viem delegates ABI string parsing to the external `abitype` library; no compile-time position tracking of parse errors occurs in viem itself.
- **No T3 (State Machine with Finalizer Slot):** viem does not implement its own type-state machine for incremental parsing. Runtime parsing is delegated to abitype.
- **No T9 (Phantom-Parameter Error Messages):** Context-specific constraint errors do not appear; generic constraint violations fall back to union widening.
- **No T14 (Generic Context Binding Errors):** Generic parameter validation relies on abitype's type extraction; viem does not add secondary validation of generic counts or type mismatches.
- **No T15 (Declaration Mismatch Objects):** viem does not implement side-by-side `declared` vs. `inferred` error objects; type mismatches are handled by abitype.

---

## Cross-References

**Related Audits:**

- **ArkType:** Implements T8, T3, T1, T2 for full string-DSL parsing with position tracking.
- **Drizzle ORM:** Uses Prettify (T10) and branded types (T11) extensively for schema inference.
- **TanStack Router:** Uses T6 (constraint validation) for route parameter narrowing.

**Pipesafe Analogs:**

- `Pipeline.ts`: Accumulate stages using `Calls<>` pattern (T5 variant).
- `match.ts`: Narrow predicates using `CheckArgs<>` pattern (T4).
- `fieldReference.ts`: Brand field paths using `Branded<string, "FieldPath">` (T11).
- `group.ts`: Fallback union widening like `ContractFunctionName<>` (T6+T7).
- `set.ts`: Apply `Prettify<>` to computed field output types (T10).

---

## Summary

viem's type-level DX is **focused and pragmatic**, delegating heavy lifting (ABI parsing, type extraction) to `abitype` while investing in **clean error intersections** (branded types, `ErrorType<>` constraints), **readable type display** (`Prettify`), and **safe union narrowing** (ternary fallbacks, `never` filters). For pipesafe, the most applicable patterns are:

1. **Branded types** (T11) for distinguishing valid field references from invalid ones.
2. **Recursive tuple accumulation** (T5 variant) for stage-by-stage pipeline building.
3. **Constraint-side narrowing** (T6+T7) for predicate type refinement.
4. **Prettify flattening** (T10) for final output type clarity.

viem does **not** implement sophisticated compile-time string parsing (unlike ArkType); instead, it relies on abitype's external parsing and focuses on **post-extraction type safety**.
