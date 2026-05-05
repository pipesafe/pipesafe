# type-plus: Type-Level Error DX Audit

**Repository:** [type-plus](https://github.com/unional/type-plus) (unional/type-plus)  
**Audit Date:** 2026-05-05  
**Codebase Size:** ~32k LOC (src/, non-test)  
**Version:** 8.0.0+

---

## Executive Summary

type-plus implements a **deliberate, export-oriented error-typing system** that treats type-level validation errors as first-class values. Its core innovation is the **$Error branded type** and a sophisticated **branch selection system** ($Then/$Else/$Special) that enables composable, reusable predicates with optional error context. Unlike ArkType's string DSL focus, type-plus emphasizes **structural type predicates** and **customizable error resolution**. The library is foundational for advanced TypeScript type programming, with direct applicability to pipesafe's deeply nested generic structures.

---

## Findings

### T1: Typed Error Returns ($Error Pattern)

**Occurrences:** 5 direct uses; 115+ `extends infer` chains enabling error propagation  
**Files:**

- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/errors/$error.ts` (core)
- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/errors/$infer_error.ts`

**Key Pattern:**

```typescript
// Core: $Error is a branded type encoding message + context type
export type $Error<M extends string, T = unknown> =
  M extends any ? $Type<"error", { message: M; type: T }> : never;

// Usage: $InferError wraps inference failures
export type $InferError<M extends string, T = unknown> =
  M extends any ? $Error<`Unable to infer: ${M}`, T> : never;
```

**Observable Effect:**  
When a type-level inference fails, IDEs hover to show: `$Error<"Unable to infer: ...", ActualType>`. Error is **structural** (not string-based), allowing downstream types to inspect both message and original type. `$Error` is exported publicly and composable.

**Applicability to pipesafe:** Direct—pipesafe's aggregation stages can encode intermediate state + error diagnostics via `$Error<"Stage X failed: reason", IntermediateType>`.

---

### T4: Conditional Degradation (with $Selection Branch System)

**Occurrences:** ~150 uses across predicates (Assignable, NotAssignable, IsString, IsArray, etc.)  
**Files:**

- `/tmp/audit-libs/type-plus/packages/type-plus/src/predicates/assignable.ts`
- `/tmp/audit-libs/type-plus/packages/type-plus/src/predicates/not_assignable.ts`
- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/branch/$selection.ts`

**Key Pattern:**

```typescript
// Generic predicate with customizable $Then/$Else branches
export type Assignable<A, B, $O extends Assignable.$Options = {}> = $Special<B, {
  $any: $ResolveBranch<$O, [0 extends 1 & A ? $Any : unknown, $Then], A>
  $unknown: ...
  $else: Assignable.$<A, B, $O>
}>

// Users can override:
type R = Assignable<1, number, { selection: 'filter' }>     // 1
type R = Assignable<1, number, { selection: 'predicate' }>  // true
type R = Assignable<1, string, Assignable.$Branch>          // $Else (typed marker)
```

**Observable Effect:**  
Each predicate is context-sensitive: it can return boolean (predicate mode), filter type (filter mode), or branded $Then/$Else markers (branch mode) for precise control. `$Resolution` resolves these branch paths at compile time.

**Applicability to pipesafe:** Highly applicable—pipesafe stages can use `{ selection: 'filter' }` to enforce strict type narrowing in pipeline chains.

---

### T6: Constraint-Side Validation (Generic Constraints)

**Occurrences:** 60+ uses in predicates  
**Files:** All predicate types in `/tmp/audit-libs/type-plus/packages/type-plus/src/predicates/`

**Key Pattern:**

```typescript
export type Assignable.$Options = $Selection.Options & $Distributive.Options & $InputOptions<$Any | $Unknown | $Never>

// Constraints enforced at instantiation:
type YourType<T, $O extends YourType.$Options = YourType.$Branch> = ...
```

**Observable Effect:**  
If a user passes an invalid option object, IDE shows type mismatch on the constraint itself, preventing misuse before evaluation.

---

### T7: Inference Capture via $Special and Branch Dispatch

**Occurrences:** ~80 uses in special-type handlers  
**Files:**

- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/special/$special.ts`
- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/special/$any.ts`, `$never.ts`, `$unknown.ts`

**Key Pattern:**

```typescript
// $Special checks for special types (any, unknown, never, void) and routes to handlers
export type $Special<T, $O extends $Special.Options = {}> =
  0 extends 1 & T ? $ResolveBranch<$O, [$Any, $Then], T>
  : [T, unknown] extends [unknown, T] ? $ResolveBranch<$O, [$Unknown, $Then], T>
  : [T, never] extends [never, T] ? $ResolveBranch<$O, [$Never, $Then], T>
  : $ResolveBranch<$O, [$Else]>;
```

**Observable Effect:**  
A single type can be parameterized to handle any/unknown/never as special cases with custom logic. Each branch receives context about which special type triggered it.

**Applicability to pipesafe:** Enables pipeline stages to specialize handling for `any` inputs (unknown schema) or `never` outputs (impossible constraint).

---

### T10: Hover-Flattening via $Type Branded Intersection

**Occurrences:** 22 uses of Brand pattern; implicit in all $Type uses  
**Files:**

- `/tmp/audit-libs/type-plus/packages/type-plus/src/nominal/brand.ts`
- `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/$type.ts`

**Key Pattern:**

```typescript
// $Type creates branded intersection: displays as { _$type, _$value } & V
export type $Type<T extends string, V, $O> =
  $O extends { bare: true } ? $Type.$<T, V>
  : [V] extends [null] | [undefined] | [symbol] | [void] ? $Type.$<T, V>
  : $Type.$<T, V> & V; // Intersection for prettier hover

declare const _$type: "_$type";
declare const _$value: "_$value";
```

**Observable Effect:**  
Hovers on $Error types show a flattened intersection: `{ _$type: 'error'; \_$value: { message: string; type: T } } & T`, making error structure explicit and readable.

---

### T11: Branded Symbol Tracking

**Occurrences:** 22 occurrences (Brand, Flavor, $Type keys)  
**Files:**

- `/tmp/audit-libs/type-plus/packages/type-plus/src/nominal/brand.ts` (Brand<B, T>, Branded<B, T>)
- `/tmp/audit-libs/type-plus/packages/type-plus/src/nominal/constants.ts` (typeSym, valueSym)

**Key Pattern:**

```typescript
declare const uniSym: unique symbol;
export interface Branded<B extends string, T> {
  [typeSym]: B;
  [valueSym]: T;
}

export type Brand<B extends string, T = never> =
  [T] extends [null | undefined | symbol | void] ? Branded<B, T>
  : Branded<B, T> & T; // Preserve nominal identity + value type
```

**Observable Effect:**  
Branded types are tracked via unique symbol keys; at runtime, brands can be inspected via symbol lookup; at compile-time, they flow through predicate systems unchanged.

---

### T13: Error Accumulation Strategy (Short-Circuit)

**Occurrences:** Implicit in all predicates (single condition, no accumulation)  
**Files:** All predicate types

**Pattern:**  
Predicates evaluate left-to-right and return immediately on first decision (e.g., in $Special, checks any/unknown/never in fixed order). No error accumulation object.

**Observable Effect:**  
IDE reports errors one at a time as types fail validation, enabling rapid iteration.

---

## New/Unique Techniques in type-plus

### T16 (Novel): $Distributive and Conditional Branching for Generic Context

**Occurrences:** 50+ uses across predicates  
**Files:** `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/distributive/$distributive.ts`

**Key Pattern:**

```typescript
// Distributive parsing: controls whether conditional types distribute over unions
export type $Distributive = {
  distributive?: boolean
}

type Assignable.$UtilOptions = $Selection.Options & $Distributive.Options
// When distributive: true, `Assignable<string | number, string>` →
//   Assignable<string, string> | Assignable<number, string>
```

**Applicability:**  
For pipesafe's union handling in aggregation stages, this allows per-stage control over union distributivity.

---

### T17 (Novel): Predicate Composition via $ResolveBranch Tree

**Occurrences:** 150+ nested $ResolveBranch calls  
**Files:** `/tmp/audit-libs/type-plus/packages/type-plus/src/$type/branch/$resolve_branch.ts`

**Key Pattern:**

```typescript
export type $ResolveBranch<$O, $Branches, D> =
  $Branches extends [infer B] ? _Last<$O, B, D>
  : $Branches extends [infer B, ...infer Rest] ?
    _<$O, B, $ResolveBranch<$O, Rest, D>>
  : $InferError<"$Branches must have at least one entry">;
```

**Applicability:**  
Enables pipesafe to build predicate chains where each link can return a branch marker ($Then/$Else) that flows upstream for decision-making.

---

## Applicability to pipesafe (5/5 pain points)

1. **Deeply Nested Generics:** $Type, $Error, and $Special handle multi-level nesting with branded context tracking.
2. **Union Distribution:** $Distributive controls when/how unions split across stages.
3. **Validation + Inference:** $Error captures both error message and inferred intermediate type.
4. **Predicate Composition:** $ResolveBranch enables chaining validation rules.
5. **Error Context:** $Then/$Else branch markers allow downstream stages to act on validation results.

---

## Conclusion

type-plus's error DX hinges on **$Error as a first-class branded type** and **$Selection/$Special for composable, context-aware branching**. Unlike ArkType's string-DSL focus, type-plus is **library-agnostic** and designed for **reusable type predicates**. The **export of $Then/$Else/$Error types** is deliberate, making errors inspectable and actionable in downstream code. For pipesafe, this model is highly applicable: intermediate aggregation states can encode errors and next-stage logic via type parameters, enabling rich IDE tooltips and zero-cost type-level error recovery.

---

**Key Exported Types for Integration:**

- `$Error<M, T>` — Error with message + context type
- `$Then`/`$Else` — Branch markers for conditional type navigation
- `Assignable<A, B, $O>` — Predicate template for constraint checking
- `Brand<B, T>` — Nominal typing for stage identification
- `$Type<T, V>` — Branded intersection for error display
