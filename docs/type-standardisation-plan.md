# Type System Standardisation Plan

Status: proposal (not yet implemented)
Scope: `@pipesafe/core` type-level code — `src/elements/`, `src/stages/`, `src/utils/core.ts`, `src/pipeline/Pipeline.ts`.

This document reviews the current type architecture, answers the question
"should each stage/expression have a container type like
`type XXX<A, B, C> = { infer: ..., validate: ..., other: ... }`?", defines the
target conventions, and lays out a phased execution plan.

---

## 1. Current-state review

Every stage and expression in the library plays some subset of three roles:

| Role         | Purpose                                                              | Example                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------ |
| **Query**    | The shape the user may write (input constraint, often carrying brands) | `MatchQuery<Schema>`               |
| **Validate** | A mapped wrapper used at the parameter position to make brands fire at the call site | `ValidateProjectQuery<Schema, P>` |
| **Resolve**  | The output schema after the stage / result type of the expression    | `ResolveMatchOutput<Query, Schema>` |

The roles exist almost everywhere, but the naming, parameter order, error
handling and early-exit behavior differ file by file. Findings:

### F1. Naming and parameter-order drift

- `Resolve*Output` parameter order is split roughly down the middle:
  `<Query, Schema>` (match, set, unset, project, replaceRoot, sort-by-doc) vs
  `<Schema, Query>` (group, facet, unwind, lookup, graphLookup, unionWith).
- Input-shape naming is split: `*Query` (match, set, group, project, sort,
  unset, facet, replaceRoot, sample, out) vs `*Options` (merge, unwind's
  `UnwindOptions`).
- `lookup.ts`/`unionWith.ts` call the current schema `StartingDocs` when it is
  actually `PreviousStageDocs` in Pipeline terms.

### F2. PassThrough / early-exit applied inconsistently

`PassThrough` (error short-circuit) is applied **inside** most resolvers, but:

- `count.ts` does not apply it at all (`ResolveCountOutput<FieldName>` never
  sees the schema, so an upstream `PipeSafeError` is silently replaced by
  `{ total: number }`).
- `sort.ts` defines `ResolveSortOutput` (with PassThrough, and it is covered by
  `Pipeline.typeAssertions.ts`), but `Pipeline.sort` **does not use it** — it
  returns `PreviousStageDocs` directly.
- `out`/`merge` are terminal (`never` output) so they get a pass, but that
  exemption is nowhere written down.
- Distribution control over union schemas is ad hoc: `unwind.ts` uses
  `Schema extends unknown ?`, `lookup.ts` uses `StartingDocs extends any ?`,
  others rely on `Prettify` happening to not distribute. Non-distributive
  checks are mostly `[T] extends [X]` per CLAUDE.md, but not audited.

### F3. Operand helpers are duplicated with three naming schemes

The "valid value or branded error" pattern is re-implemented in three files:

- `stages/match.ts`: `NumericOperand<T, Op>`, `SizeOperand<T>`,
  `ArrayValueOperand<T, Op>`, `ArrayElementOperand<T, Op>`, `RegexOperand<T>` —
  these validate **the field's type** at a key position.
- `stages/group.ts`: `NumericAccumulatorOperand<Schema, Op>`,
  `MinMaxAccumulatorOperand<Schema, Op>`, `FlexibleAccumulatorOperand<Schema>` —
  these enumerate **acceptable values** given the schema.
- `elements/expressions.ts`: `ArithmeticOperandFor<Schema, Op>`,
  `StringOperandFor<Schema, Op>`, `ArrayOperandFor<Schema, Op>`,
  `DateOperand<Schema, Op>` (no `For` suffix), `ConditionalOperand<Schema>`,
  `ComparisonOperand<Schema>`.

These are actually **two distinct patterns** that should each have one home:

1. **Field-position operand check** (match): given the resolved field type `T`,
   return the allowed operand type or a brand. Always non-distributive
   (`[T] extends [...]`).
2. **Expression-position operand set** (group/expressions): given `Schema`,
   return the union of acceptable literals/refs/expressions plus a brand arm.

The brand messages are assembled by hand in each helper; consistency with the
CLAUDE.md message skeleton is enforced only by review.

### F4. Expression system: registration spread over 4–5 sites, with drift

Adding one expression operator today touches:

1. The operator's own type (`SizeExpression<Schema>`).
2. Its category union (`ArrayExpression<Schema>`).
3. The category inferrer (`InferArrayExpression<Schema, Expr>`).
4. The top-level dispatch `InferExpression<Schema, Expr>`.
5. Possibly the **second, near-duplicate internal dispatch**
   `InferExpressionType<Schema, Expr>` (used by `$ifNull`/`$cond` operand
   inference).

(4) and (5) have already drifted: `InferArrayExpression` resolves
`$arrayElemAt` on a field reference via `InferArrayElementType`, while
`InferExpressionType` only handles array literals (`Arr extends (infer E)[]`),
so the same expression infers differently depending on whether it appears
top-level or nested inside a conditional. `expressions.ts` also locally
redefines `NonNullable`, shadowing the TS built-in.

This is the strongest case in the codebase for the proposed container type.

### F5. Vestigial / unwired types

- `elements/arrayOperator.ts` — `ArrayOperation` / `InferArrayOperation` are
  referenced nowhere else and use the pre-`PipeSafeError` ad-hoc
  `O & { error: 1 }` pattern.
- `elements/fieldReference.ts` — `MatcherThatOnlyDoesEquals`,
  `ElementResolvingToType`, `ArrayResolvingToType` have no consumers outside
  the file.
- `stages/unwind.ts` — `UnwindQuery`/`UnwindOptions`/`UnwindPath` exist (and
  `UnwindPath` carries a documented brand), but `Pipeline.unwind` **inlines its
  own parameter shape** constrained by the raw
  `FieldReferencesThatInferTo<..., unknown[]>` — so the
  `'$unwind' requires an array field reference.` brand never fires at the
  chained call site. The brand is only reachable if a user annotates
  `UnwindQuery` manually.
- `stages/sort.ts` — `ResolveSortOutput` unused by `Pipeline.sort` (F2).
- `utils/core.ts` — `ExpandAllDotted` retained alongside the
  `ExpandAllDottedIterative` actually used by `FlattenDotSet`;
  `MergeExpandedObjectsIterative`, `SeparateKeys` and several "Stage N.M"
  optimization-log comments describe history rather than behavior.

### F6. `utils/core.ts` is a 700-line grab-bag

It mixes five unrelated concerns: error brand machinery (`PipeSafeError`,
`PassThrough`, `IsPipeSafeError`), string/char unions (`NoDollarString`,
`Alphabet`), dotted-path machinery (`ExpandDottedKey*`, `FlattenDotSet`),
deep-merge machinery (`MergeNested`, `IsPlainObject`), and the entire `$set`
update semantics (`ApplySetUpdates` and ~15 helpers used only by
`stages/set.ts`).

### F7. Unknown-path behavior is asymmetric between selectors and references

- `GetFieldTypeWithoutArrays` (field **references**, `$`-prefixed) returns
  `PipeSafeError<"Field '...' is not on the schema.">` for unknown paths.
- `GetFieldType` (field **selectors**, key position) returns `never`.

Some of the `never`s are load-bearing (union narrowing in
`FieldMatchingInterim`), but the asymmetry is undocumented and means selector
typos in places that use `GetFieldType` directly degrade silently.

### F8. `group.ts` accumulator list is registered twice

`AccumulatorFunction` (the input union) and `ResolveAccumulatorFunction` (the
output dispatch) each enumerate the nine accumulators independently — the same
multi-site registration problem as F4, just smaller.

---

## 2. Should we adopt a container type per stage/expression?

The proposal: `type XXX<A, B, C> = { infer: ..., validate: ..., other: ... }`.

### What TypeScript allows

TS has no higher-kinded types, so a `StageSpec` container can never be passed
around as a type constructor — `Pipeline` could not be written generically over
"any stage spec". What *is* possible is a **registry interface** whose members
are object types with well-known keys:

```ts
interface StageSpec<Schema extends Document, Q> {
  query: ...;    // input constraint
  validate: ...; // identity-or-branded mapped type (parameter position)
  output: ...;   // resolved schema
}
```

Interface members resolve lazily, so `StageSpec<S, Q>["output"]` does not pay
for the unused members. The cost is **indirection in diagnostics**: hovers and
error messages start showing `MatchSpec<S, Q>["output"]`-shaped aliases, and
the carefully-tuned TS2322-at-the-offending-value behavior (see CLAUDE.md
"Error code: prefer TS2322 over TS2353") is easy to regress when the parameter
type goes through an indexed access.

### Recommendation

**Adopt the container idea where the registration problem is real, keep plain
types at the user-facing boundary.** Concretely:

1. **Expressions: YES — full registry container.** This is where 4–5
   registration sites have already drifted (F4). One interface, keyed by
   operator, holding `{ operand; returns }` per operator:

   ```ts
   // elements/expressions.ts (target shape)
   interface ExpressionSpec<Schema extends Document> {
     $size:   { operand: ArrayOperand<Schema, "$size">;    returns: number };
     $concat: { operand: StringOperand<Schema, "$concat">[]; returns: string };
     $add:    { operand: ArithmeticOperand<Schema, "$add">[]; returns: number };
     $dateToString: { operand: { format: string; date: DateOperand<Schema, "$dateToString">; ... }; returns: string };
     // ...
   }

   // Derived mechanically — never hand-maintained again:
   type ExpressionFor<Schema, Op extends keyof ExpressionSpec<Schema>> =
     { [K in Op]: ExpressionSpec<Schema>[K]["operand"] };
   export type Expression<Schema extends Document> =
     { [Op in keyof ExpressionSpec<Schema>]: ExpressionFor<Schema, Op> }[keyof ExpressionSpec<Schema>];
   ```

   `InferExpression` first checks a small explicit dispatch for the ~6
   operators whose result depends on the **literal** arguments
   (`$concatArrays`, `$arrayElemAt`, `$filter`, `$ifNull`, `$cond`,
   `$literal`), then falls back to `ExpressionSpec<Schema>[Op]["returns"]` for
   every fixed-return operator. The duplicate `InferExpressionType` is deleted;
   `$ifNull`/`$cond` operand inference calls the one real `InferExpression`.
   Category unions (`ArithmeticExpression` etc.) survive as derived
   `Pick`-style views over the registry where match/group still need them.

2. **Accumulators: YES — same registry pattern, small scale.** One
   `AccumulatorSpec<Schema>` interface replaces the parallel
   `AccumulatorFunction` / `ResolveAccumulatorFunction` lists (F8).

3. **Stages: CONVENTION + conformance test, not a container.** Each stage
   module exports a standardized trio (section 3) with standard names and
   parameter order. A new `stages/stages.contract.typeAssertions.ts` pins the
   contract for every stage:

   - `ResolveXxxOutput<Schema, Q>` forwards `PipeSafeError` schemas verbatim
     (PassThrough), asserted per stage:
     `Assert<Equal<ResolveSetOutput<PipeSafeError<"x">, Q>, PipeSafeError<"x">>>`.
   - Each stage's Pipeline method actually uses its module's Query/Validate/
     Resolve types (prevents the `sort`/`unwind` drift in F2/F5 from
     recurring).

   A container at the method-signature position is rejected because (a) the
   three documented signature patterns (direct / validation-mapped / generic
   constraint) exist precisely because stages need *different* parameter-position
   tricks to make brands fire, and a uniform wrapper would undo that tuning;
   (b) hover/error quality is the product; (c) without HKTs the abstraction
   buys no reuse in `Pipeline` anyway.

---

## 3. Target conventions

### 3.1 The stage trio

Every file in `stages/` exports, with **Schema always the first parameter**:

| Export                          | Required | Notes |
| ------------------------------- | -------- | ----- |
| `XxxQuery<Schema>`              | yes (unless the stage takes a scalar, e.g. `limit`) | Rename `MergeOptions` → keep public alias, internal name `MergeQuery`; fold `UnwindOptions` into `UnwindQuery`. |
| `ValidateXxxQuery<Schema, Q>`   | only when the stage uses the validation-mapped signature pattern | Currently only `project`; `group`'s known limitation (CLAUDE.md) is the candidate follow-up. |
| `ResolveXxxOutput<Schema, Q>`   | yes      | Must wrap its body in `PassThrough<Schema, ...>`. Terminal stages (`out`, `merge`) are exempt and say so in a doc comment. |

Standard generic names: `Schema` for the incoming docs (replace
`StartingDocs`/`PreviousStageDocs` inside stage files), `Q` for the literal
query, `Foreign` for joined schemas.

### 3.2 Operand kernel — new `elements/operands.ts`

Two primitives replace the eleven ad-hoc helpers from F3:

```ts
/** Field-position check: the field's resolved type T must satisfy Allowed.
 *  Non-distributive by construction. */
export type FieldOperand<T, Allowed, Msg extends string> =
  [T] extends [Allowed] ? T : PipeSafeError<Msg>;

/** Expression-position set: acceptable literals/refs for a target type,
 *  with the brand arm for hover messaging. */
export type ExpressionOperand<Schema extends Document, T, Msg extends string> =
  | T
  | FieldReferencesThatInferTo<Schema, T>
  | PipeSafeError<Msg>;
```

Message text stays at the call site (so each operator keeps its precise
wording) but is built through shared template helpers so the CLAUDE.md skeleton
is enforced structurally:

```ts
// utils/errors.ts
export type RequiresMsg<
  Subject extends "Operator" | "Accumulator" | "Stage",
  Op extends string,
  What extends string,
> = `${Subject} '${Op}' requires ${What}.`;
```

Existing helpers become one-liners over the kernel, e.g.
`type NumericOperand<T, Op extends string> = FieldOperand<T, number | Date, RequiresMsg<"Operator", Op, "a numeric or date field">>`.

### 3.3 Early-exit and distribution rules (written into CLAUDE.md)

1. Every non-terminal `ResolveXxxOutput` wraps in `PassThrough<Schema, ...>` —
   no exceptions, enforced by the contract assertions.
2. Non-distributive comparisons use `[A] extends [B]`; **intentional**
   distribution over union schemas uses the single idiom
   `Schema extends unknown ?` with a `// distribute over union schemas` comment
   (replace the `extends any` variant in lookup.ts).
3. Brands at value positions, not whole-parameter wrapping (already documented;
   the contract file pins it per stage).
4. Unknown-path behavior: keep `GetFieldType` → `never` (load-bearing for union
   narrowing) but document the asymmetry with F7's rationale at both
   definitions, and add a branded sibling
   (`GetFieldTypeOrError<Schema, Path>`) for call sites that surface to users.

### 3.4 Utils split

`utils/core.ts` splits along its existing seams (pure moves, no logic change):

| New module          | Contents |
| ------------------- | -------- |
| `utils/errors.ts`   | `PipeSafeError`, `IsPipeSafeError`, `PassThrough`, `RequiresMsg` |
| `utils/strings.ts`  | `DollarPrefixed`, `WithoutDollar`, `NoDollarString`, `Alphabet`/`Digit`, `Join`, `IndexStr` |
| `utils/paths.ts`    | `ExpandDottedKey*`, `FlattenDotSet`, `HasDottedKeys`, `RemoveDottedKeys`, `ExpandAllDotted*` |
| `utils/merge.ts`    | `MergeNested`, `IsPlainObject`, `Prettify`, `UnionToIntersection`, `ExclusifyUnion` |
| `stages/set.ts`     | `ApplySetUpdates` + its ~15 private helpers move next to their only consumer |

`utils/core.ts` remains as a re-export barrel so nothing outside the package
breaks (`Document`, `Prettify`, `PipeSafeError`, `IsPipeSafeError`,
`PassThrough` are public API via `index.ts`).

---

## 4. Phased execution plan

Each phase is a separate PR, gated by: `bun run build`, all
`*.typeAssertions.ts` green, `Pipeline.callSite.typeAssertions.ts` untouched or
strengthened (never weakened), and `packages/core/benchmarking` instantiation
counts within noise of the previous baseline. Changesets: phases 1–4 are
`patch` (internal); phase 5 is `minor` if any new public types are exported.

### Phase 0 — Pin current behavior (the safety net)

- Add `stages/stages.contract.typeAssertions.ts`: per-stage PassThrough
  assertions, per-stage "Pipeline method uses the module's types" assertions.
  Expect this to **fail** for `count` (no PassThrough), and to make the
  `sort`/`unwind` wiring gaps visible — mark those with
  `ExpectAssertFailure`/TODO so the gap is recorded before it's fixed.
- Record benchmark baseline numbers in the PR description.

### Phase 1 — Dead code and drift fixes (small, high-value)

- Delete `elements/arrayOperator.ts`; delete `MatcherThatOnlyDoesEquals`,
  `ElementResolvingToType`, `ArrayResolvingToType` (or move to a quarantine
  file if Manifold examples touch them — verify first).
- Wire `Pipeline.sort` to `ResolveSortOutput`; wire `Pipeline.unwind` to
  `UnwindQuery`/`UnwindPath` so the documented `$unwind` brand actually fires
  at chained call sites (add a callSite assertion for it).
- Add `PassThrough` to `ResolveCountOutput` (needs the schema parameter:
  `ResolveCountOutput<Schema, FieldName>`).
- Remove the local `NonNullable` shadow in `expressions.ts`.
- Prune the unused `ExpandAllDotted` variant and convert "Stage N.M"
  optimization-log comments into a single short note (history lives in git).

### Phase 2 — Shared kernels

- Create `utils/errors.ts` (`RequiresMsg`) and `elements/operands.ts`
  (`FieldOperand`, `ExpressionOperand`).
- Migrate match.ts, group.ts, expressions.ts operand helpers onto the kernel.
  Hover text must remain byte-identical — assert the exact brand messages in
  the existing typeAssertions before/after.
- Execute the utils split (3.4) as pure moves with a re-export barrel.

### Phase 3 — Stage trio standardization

- Normalize names and parameter order (`<Schema, Q>`) across all stage files
  and their `Pipeline` call sites. All internal except the four exported
  resolvers (`limit`, `skip`, `sample`, `count`) and `MergeOptions` — keep
  deprecated aliases for those, remove at next major.
- Rename `StartingDocs` → `Schema` inside lookup/unionWith/graphLookup stage
  files (cosmetic, but it currently misstates which schema flows in).
- Flip the Phase-0 `ExpectAssertFailure` markers to real assertions.

### Phase 4 — Registry containers

- Rebuild `expressions.ts` around `ExpressionSpec<Schema>` (section 2.1):
  derive `Expression`, category views, and the fixed-return arm of
  `InferExpression`; delete `InferExpressionType`; route `$ifNull`/`$cond`
  operand inference through the single dispatch. This phase carries the most
  diagnostic-display risk — review every changed hover in
  `set.typeAssertions.ts` / `project.typeAssertions.ts` with
  `.claude/inspect-types.ts`.
- Rebuild `group.ts` accumulators around `AccumulatorSpec<Schema>` the same
  way. (This may also unlock the documented `Pipeline.group` call-site brand
  limitation, but treat that as a stretch goal, not a gate.)

### Phase 5 — Documentation

- Replace the relevant CLAUDE.md sections with the conventions in section 3
  (trio naming, operand kernel, early-exit rules, registry pattern, and the
  explicit "stages get conventions, expressions get registries" decision).
- Document the selector/reference `never`-vs-brand asymmetry (F7) at both
  definitions.

---

## 5. Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Error/hover display regressions (the product) | Brand messages asserted byte-for-byte in typeAssertions; `callSite.typeAssertions.ts` never weakened; `inspect-types.ts` spot checks in Phase 4 review. |
| Type-instantiation count regressions | Benchmark gate per phase against the Phase-0 baseline. |
| Registry indirection worsening hovers | Registry is internal only — user-facing parameter types remain plain (`Expression<Schema>` stays a union alias); if a derived union displays worse than the hand-written one, fall back to hand-written union + registry-driven conformance assertion instead. |
| Public API breakage | Only `limit`/`skip`/`sample`/`count` resolvers, `MergeOptions`, `SampleQuery` and the `utils/core` quintet are exported; all keep aliases until next major. |
