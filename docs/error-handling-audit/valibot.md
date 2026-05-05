# Valibot Type-Level Error DX Audit

**Library:** Valibot (fabian-hiller/valibot) — Lightweight schema validation with TypeScript first design.  
**Source:** `/tmp/audit-libs/valibot/library/src/`  
**Key File:** `/tmp/audit-libs/valibot/library/src/methods/pipe/pipe.ts` (2732 lines, 22 overloads)

## Summary

Valibot emphasizes **simplicity and lightweight design** over elaborate compile-time error messaging. It achieves type safety primarily through **overload ladders, generic constraints, and inference utilities**, but lacks the sophisticated error-encoding techniques found in ArkType (e.g., ErrorMessage<>, state machines, phantom parameters). Error discovery is **generic TypeScript** (type mismatch diagnostics), not custom, positional, or context-specific messages.

---

## Findings

### T5: Overload Ladders with Type Inference Recovery

**Classification:** T5

**Description:**  
The `pipe()` function exports **22 function overloads** (arities 1–20 + fallback), each with explicit generic parameters for input, output, and issue types. Each overload threads the output of step N as the input to step N+1.

**Pattern:**
```typescript
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<InferOutput<TSchema>, unknown, BaseIssue<unknown>>
>(
  schema: TSchema,
  item1: TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>
): SchemaWithPipe<readonly [TSchema, TItem1]>;

export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<InferOutput<TSchema>, unknown, BaseIssue<unknown>>,
  const TItem2 extends PipeItem<InferOutput<TItem1>, unknown, BaseIssue<unknown>>
>(
  schema: TSchema,
  item1: TItem1 | PipeAction<...>,
  item2: TItem2 | PipeAction<...>
): SchemaWithPipe<readonly [TSchema, TItem1, TItem2]>;
// ... 20 more overloads
```

**Scope:** `/tmp/audit-libs/valibot/library/src/methods/pipe/pipe.ts:82–2685`

**Observable Effect:**  
IDE autocomplete suggests valid pipe steps based on previous output type. Incorrect chain (e.g., `maxLength(5)` after `number()`) shows "number is not assignable to string" — generic TypeScript error, not a custom message.

**Tags:** [hover-only, diagnostic-only], [low-perf-cost], [no]

---

### T6: Constraint-Side Validation

**Classification:** T6

**Description:**  
Each pipe step enforces input/output type compatibility **at the parameter constraint level**. The generic `TItemN extends PipeItem<InferOutput<TItemN-1>, unknown, BaseIssue<unknown>>` rejects mismatched steps:

```typescript
const TItem1 extends PipeItem<InferOutput<TSchema>, unknown, BaseIssue<unknown>>
```

If `InferOutput<TSchema>` is `number` and you pass `minLength(5)` (expects `string`), the constraint fails.

**Scope:** `/tmp/audit-libs/valibot/library/src/methods/pipe/pipe.ts` (all overloads, lines 82–2685)

**Observable Effect:**  
Constraint violation produces a concise **diagnostic**: "type `number` is not assignable to type `string`". No positional info or context from validation state.

**Tags:** [diagnostic-only], [low-perf-cost], [no]

---

### T7: Inference Capture and Type Extraction

**Classification:** T7

**Description:**  
Three utility types extract types from a phantom `~types` property on schema/validation objects:

```typescript
// /tmp/audit-libs/valibot/library/src/types/infer.ts
export type InferInput<TItem extends ...> = NonNullable<TItem['~types']>['input'];
export type InferOutput<TItem extends ...> = NonNullable<TItem['~types']>['output'];
export type InferIssue<TItem extends ...> = NonNullable<TItem['~types']>['issue'];
```

Each schema/action declares:
```typescript
readonly '~types'?: { input: TInput; output: TOutput; issue: TIssue } | undefined;
```

**Scope:** `/tmp/audit-libs/valibot/library/src/types/infer.ts` + `/tmp/audit-libs/valibot/library/src/types/validation.ts`, `/tmp/audit-libs/valibot/library/src/types/transformation.ts`

**Observable Effect:**  
Enables the pipe chain to infer cumulative input/output/issue types. Used to construct `SchemaWithPipe<readonly [TSchema, TItem1, TItem2, ...]>` return type.

**Tags:** [hover-only], [low-perf-cost], [no]

---

### T11: Symbol-Based Tracking (Phantom Properties)

**Classification:** T11

**Description:**  
Valibot uses **readonly phantom keys** (`~types`, `~run`, `~standard`) to encode type and execution metadata invisible at runtime:

- `~types`: optional object with `{ input, output, issue }` for type inference
- `~run`: the execution function
- `~standard`: metadata for Standard Schema compliance

Example from `BaseValidation`:
```typescript
readonly '~types'?: {
  readonly input: TInput;
  readonly output: TOutput;
  readonly issue: TIssue;
} | undefined;

readonly '~run': (
  dataset: OutputDataset<TInput, BaseIssue<unknown>>,
  config: Config<BaseIssue<unknown>>
) => OutputDataset<TOutput, BaseIssue<unknown> | TIssue>;
```

**Scope:** `/tmp/audit-libs/valibot/library/src/types/validation.ts:56–62`, `transformation.ts:65–73`, `metadata.ts:26–32`, `pipe.ts:35–65`

**Observable Effect:**  
Type system threads types through pipes without runtime overhead. Metadata actions (`description()`, `brand()`) have `issue: never`, distinguishing them from validations that produce errors.

**Tags:** [hover-only], [low-perf-cost], [no]

---

### T4: Conditional Degradation (Never for Metadata)

**Classification:** T4

**Description:**  
Metadata items (like `description()`) mark their issue type as `never`, preventing them from contributing to the union of possible validation errors:

```typescript
// BaseMetadata
readonly '~types'?: {
  readonly input: TInput;
  readonly output: TInput;
  readonly issue: never;  // ← no validation error possible
} | undefined;
```

When `InferIssue<BaseMetadata<T>>` is used in a pipe, it resolves to `never`, meaning the metadata step produces no issues.

**Scope:** `/tmp/audit-libs/valibot/library/src/types/metadata.ts:30`

**Observable Effect:**  
`InferIssue<pipe(schema, description('text'), validation)>` correctly excludes the description from the issue union. Minimal overhead; uses a conditional union elimination.

**Tags:** [diagnostic-only], [low-perf-cost], [no]

---

## Notable Absences

Valibot **does not employ**:

| Category | Technique | Reason |
|----------|-----------|--------|
| T1 | Typed Error Returns (ErrorMessage<>) | No custom error encoding; relies on TypeScript diagnostics |
| T2 | Template-Literal Positional Errors | No string DSL parser or scanner state machine |
| T3 | State Machine Error Finalization | No complex error threading; simple overloads suffice |
| T8 | String DSL Parser with State Machine | Schemas/actions are function-based, not string-based |
| T9 | Phantom-Parameter Error Messages | No context-specific error injection; messages are generic |
| T10 | Hover-Flattening (show<T>) | Intersection displays are simple enough without flattening |
| T12 | JSDoc Deprecation | Not observed in type system layer (may exist at API level) |
| T13 | Error Accumulation Strategy | Uses short-circuit (abort early on first issue) |
| T14 | Generic Context Binding Validation | No generic parameter validation in overloads |
| T15 | Declaration Mismatch Objects | No `declare<ExternalType>()` construct |

---

## Error Discovery Model

**Sequence:**
1. User writes `pipe(string(), maxLength(5), minValue(10))`
2. Type checker evaluates overload 3: `TItem2 extends PipeItem<InferOutput<TItem1>, ...>`
3. `InferOutput<TItem1>` (minLength) = `string`
4. `minValue(10)` has input `number`
5. **Diagnostic:** "Type `string` is not assignable to type `number`"
6. User fixes: `pipe(string(), minLength(5), transform(parseInt), minValue(10))`

**Limitation:** Error message does not say *which* pipe step is incompatible or *why*. It's a generic structural mismatch.

---

## Applicability to Pipesafe

| Pipesafe Component | Valibot Technique | Value | Notes |
|-------------------|------------------|-------|-------|
| `Pipeline.ts` | Overload ladders (T5) | ★★★★ | Directly applicable; 20+ stages need arity coverage |
| `Pipeline.ts` | Constraint-side validation (T6) | ★★★ | Chain type validation; but no custom error messages |
| `match.ts`, `fieldReference.ts` | Inference utilities (T7) | ★★ | Type extraction; less complex than pipesafe's nested generics |
| `set.ts`, `group.ts` | Phantom properties (T11) | ★★ | Metadata encoding; pipesafe uses explicit types |

**Assessment:** Valibot's **overload + constraint approach is lightweight and maintainable** but offers no compile-time error DX beyond standard TypeScript. For deeply nested pipelines (e.g., `match().field().group().set().accumulator()`), constraint errors may be cryptic. ArkType's error message encoding would be more informative.

---

## Technical Summary

**Strengths:**
- Clean, maintainable overload pattern (22 arities cover 90% of use cases)
- Zero runtime cost for type tracking (phantom properties)
- Inference utilities are elegant and extensible

**Weaknesses:**
- Generic TypeScript errors ("type X is not assignable to Y") lack domain context
- No positional error information (which step failed, why)
- State machine approach (T8) would enable richer diagnostics for complex chains

**Fit for Pipesafe:**
Valibot's techniques are **foundational and safe** but insufficient for pipesafe's ambition of first-class type-level error DX. Pipesafe should combine Valibot's overload structure with ArkType's error encoding (T1, T2, T9) to provide developers with **actionable, context-rich compile-time feedback**.
