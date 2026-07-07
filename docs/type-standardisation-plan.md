# Type System Standardisation Plan

Status: IMPLEMENTED (see §6 for the A/B comparison decisions); §7 records
the post-review follow-up plan (maintainer decisions from the PR #102 review)
Scope: `@pipesafe/core` type-level code — `src/elements/`, `src/stages/`, `src/utils/core.ts`, `src/pipeline/Pipeline.ts`.

This document reviews the current type architecture, answers the question
"should each stage/expression have a container type like
`type XXX<A, B, C> = { infer: ..., validate: ..., other: ... }`?", defines the
target conventions, and lays out a phased execution plan.

---

## 1. Current-state review

Every stage and expression in the library plays some subset of three roles:

| Role         | Purpose                                                                              | Example                             |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------- |
| **Query**    | The shape the user may write (input constraint, often carrying brands)               | `MatchQuery<Schema>`                |
| **Validate** | A mapped wrapper used at the parameter position to make brands fire at the call site | `ValidateProjectQuery<Schema, P>`   |
| **Resolve**  | The output schema after the stage / result type of the expression                    | `ResolveMatchOutput<Query, Schema>` |

The roles exist almost everywhere, but the naming, parameter order, error
handling and early-exit behavior differ file by file. Findings:

### F1. Naming and parameter-order drift

- `Resolve*Output` parameter order is split roughly down the middle:
  `<Query, Schema>` (match, set, unset, project, replaceRoot) vs
  `<Schema, Query>` (group, facet, unwind, lookup, graphLookup, unionWith);
  schema-only resolvers (sort, limit, skip, sample) take just `<Schema>`,
  and `count`'s takes only `<FieldName>` (see F2).
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
- `utils/core.ts` — `ExpandAllDotted` is unused (FlattenDotSet uses the
  `ExpandAllDottedIterative` variant); `SeparateKeys` and
  `MergeExpandedObjectsIterative` **are** live, but they and several "Stage
  N.M" optimization-log comments read as historical experiment notes rather
  than descriptions of current behavior.
- `utils/core.ts` (found during the Phase-2 split): `FlattenToNested`,
  `ExpandDottedKeyPreservingOptional` and
  `ExpandAllDottedPreservingOptional` + its seven private helpers
  (`GetTopLevelKeys`, `HasAnyRequiredSubPath`, `AreAllSubPathsOptional`,
  `Optional`/`RequiredTopLevelKeys`, `NonDottedKeys`, `BuildNestedForKey`)
  are also referenced nowhere outside the file — dropped during the split
  rather than moved.

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

### F9. Dispatch style is mixed: cheap key checks vs expensive full-union checks

Inference/dispatch types decide "what is this value?" in two different ways:

- **Operator-key presence** (cheap, short-circuits early):
  `Accumulator extends { $sum: any }` (group.ts),
  `Expr extends { $ifNull: infer Operands }`,
  `Expr extends { $concatArrays: infer Arrays }` (expressions.ts). Only the
  literal's keys are inspected; nothing schema-parameterized is instantiated
  when the key is absent.
- **Full structural match against a Schema-parameterized union** (expensive):
  `Expr extends DateExpression<Schema>`, `Expr extends ArithmeticExpression<Schema>`
  (the top-level `InferExpression` dispatch),
  `Obj extends Expression<Schema>` (in `InferNestedFieldReference` — a hot
  path, evaluated for **every value** in `$set`/`$project`/`$group` literals),
  and the stage resolvers' `Query extends SetQuery<Schema>` /
  `Query extends ProjectQuery<Schema>` / `Query extends RawMatchQuery<Schema>`
  re-checks. Each of these instantiates large unions (including
  `FieldReferencesThatInferTo`, which maps over every field path of the
  schema) just to pick a branch — even when the value has no `$` key at all
  and could have been ruled out immediately.

The full-union style also has a **robustness cost**, not just a perf cost: a
malformed-but-clearly-intended expression (e.g.
`{ $dateToString: { format: 1, date: "$ts" } }`) fails the
`extends DateExpression<Schema>` test and silently falls through to the next
arm — the inferred output changes shape entirely (literal passthrough or
`never`) instead of "this is a `$dateToString`, it returns `string`, and the
operand brand flags the bad `format`".

---

## 2. Should we adopt a container type per stage/expression?

The proposal: `type XXX<A, B, C> = { infer: ..., validate: ..., other: ... }`.

### What TypeScript allows

TS has no higher-kinded types, so a `StageSpec` container can never be passed
around as a type constructor — `Pipeline` could not be written generically over
"any stage spec". What _is_ possible is a **registry interface** whose members
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
     `Assert<Equal<ResolveSetOutput<PipeSafeError<"x">, Q>, PipeSafeError<"x">>>`
     (shown in the target `<Schema, Q>` order; the Phase-0 version uses
     today's signatures — see the Phase-0 note).
   - Each stage's Pipeline method actually uses its module's Query/Validate/
     Resolve types (prevents the `sort`/`unwind` drift in F2/F5 from
     recurring).

   A container at the method-signature position is rejected because (a) the
   three documented signature patterns (direct / validation-mapped / generic
   constraint) exist precisely because stages need _different_ parameter-position
   tricks to make brands fire, and a uniform wrapper would undo that tuning;
   (b) hover/error quality is the product; (c) without HKTs the abstraction
   buys no reuse in `Pipeline` anyway.

---

## 3. Target conventions

### 3.1 The stage trio

Every file in `stages/` exports, with **Schema always the first parameter**:

| Export                        | Required                                                         | Notes                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XxxQuery<Schema>`            | **yes — all stages, including scalar ones** (amended in §7.2)    | Rename `MergeOptions` → `MergeQuery` (public `MergeOptions` alias kept in compat, 3.7); fold `UnwindOptions` into `UnwindQuery`. Scalar stages export a schema-free alias (`LimitQuery = number`, `SkipQuery = number`, `CountQuery = string`) and the Pipeline method's parameter references it — never an inline scalar.                            |
| `ValidateXxxQuery<Schema, Q>` | only when the stage uses the validation-mapped signature pattern | Currently only `project`. **Expected to grow per-stage as feature adds** (§7.2): `group` first (§7.4), expression-position operand validation for `set`/`project` after §7.3. Validate members are DERIVED from the stage's Query building blocks and the operand kernel — they re-USE `NumericAccumulatorOperand` etc., never re-spell a constraint. |
| `ResolveXxxOutput<Schema, Q>` | yes                                                              | Must wrap its body in `PassThrough<Schema, ...>`. Terminal stages (`out`, `merge`) are exempt and say so in a doc comment.                                                                                                                                                                                                                            |

Standard generic names: `Schema` for the incoming docs (replace
`StartingDocs`/`PreviousStageDocs` inside stage files), `Q` for the literal
query, `Foreign` for joined schemas. Two sanctioned deviations: schema-free
queries (scalar stages and e.g. `SampleQuery`) take no `Schema` parameter —
but they still export the `XxxQuery` name (§7.2) — and trailing
defaulted/hoisted parameters per 3.5 may extend any trio signature.

### 3.2 Operand kernel — new `elements/operands.ts`

Two primitives replace the eleven brand-carrying helpers from F3 (the
brand-free ones — `FlexibleAccumulatorOperand`, `ConditionalOperand`,
`ComparisonOperand` — are deliberately permissive and stay as plain unions):

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
The expression-side helpers drop their inconsistent suffixes in the process
(`ArrayOperandFor` → `ArrayOperand`, `StringOperandFor` → `StringOperand`,
etc.) — these standardized names are the ones used in the registry sketch
in section 2.

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

### 3.4 Operator-key dispatch standard ("early exit" everywhere)

This generalizes the early-exit idea from F2/F9 into one enforced rule:

> **Decide what a value _is_ from its `$`-keys alone; only after dispatch,
> resolve and validate it against the schema.** Never match a value against a
> Schema-parameterized union to pick a branch.

The full early-exit ladder, from cheapest check to most expensive work:

| Tier | Check                                                          | Cost                 | Lives in                                  |
| ---- | -------------------------------------------------------------- | -------------------- | ----------------------------------------- |
| 1    | Schema is already a `PipeSafeError` → forward it               | O(1)                 | `PassThrough` in every `ResolveXxxOutput` |
| 2    | Value has no `$`-prefixed key → it's a literal, stop           | O(keys)              | new `OperatorKeyOf` dispatch              |
| 3    | `$`-key isn't a known operator → `never` / brand, stop         | O(1) registry lookup | registry dispatch                         |
| 4    | Operator known → resolve `returns`, validate operands (brands) | full schema work     | `ExpressionSpec` / operand kernel         |

Canonical helpers (new, in `utils/dispatch.ts` — created in Phase 2):

```ts
/** The $-prefixed key(s) of an expression-shaped literal, or never. */
type OperatorKeyOf<Expr> =
  Expr extends object ? keyof Expr & `$${string}` : never;

type InferExpression<Schema extends Document, Expr> =
  OperatorKeyOf<Expr> extends infer Op ?
    [Op] extends [never] ?
      NotAnExpression // tier 2: no $ key — literal
    : [Op] extends [LiteralDependentOps] ?
      InferDependentExpression<Schema, Expr, Op> // ~6 hand-written arms
    : [Op] extends [keyof ExpressionSpec<Schema>] ?
      ExpressionSpec<Schema>[Op & keyof ExpressionSpec<Schema>]["returns"]
    : never // tier 3: unknown operator
  : never;
```

`NotAnExpression` is a sentinel type (not `never`) so callers like
`InferNestedFieldReference` can distinguish "this is a literal — pass it
through" from "this dispatched but resolved to nothing". The sketch omits
the multi-operator guard for brevity: immediately after the tier-2 check
(so it runs before _both_ operator lookups), a
`[Op] extends [UnionToIntersection<Op>]`-style single-key check routes
multi-`$`-key objects to the exactly-one-operator brand described below.

Mongo forbids `$`-prefixed keys in stored documents (and `NoDollarString`
already encodes that), so `$`-key presence is a **sound discriminator**
between expression objects and nested object literals — this is what makes
tier 2 safe.

Consequences, deliberately accepted:

- **Inference becomes forgiving; validation stays strict.** A malformed
  `{ $dateToString: { format: 1, ... } }` still dispatches to `$dateToString`
  and infers `string`; the bad operand is reported by the brand at the input
  position (where the user can fix it), and the downstream schema stays
  stable instead of mutating into a literal/`never`. This is a semantic
  change from today's fall-through behavior — typeAssertion updates are
  expected and intentional.
- **Multi-operator objects become detectable.** `{ $add: [...], $size: ... }`
  yields a union `Op`, which the dispatch can brand as
  `PipeSafeError<"Expression objects must have exactly one operator.">` —
  today this falls through structural matching unpredictably.
- `OperatorKeyOf` must be guarded with `[Op] extends [never]`-style tuple
  checks (a union of keys must not distribute), and a fallback arm is needed
  for non-literal/widened `Expr`.

Where the rule applies beyond `InferExpression`:

- `InferNestedFieldReference` (hottest path): replace
  `Obj extends Expression<Schema>` with the tier-2 key check before treating
  an object as a literal.
- `ResolveMatchOutput`: replace `Query extends RawMatchQuery<Schema>` with a
  cheap `keyof Query & ("$and" | "$or" | "$nor")` check to split logical vs
  raw queries.
- Stage resolvers: drop the redundant full `Query extends SetQuery<Schema>` /
  `ProjectQuery<Schema>` re-checks — the method's generic constraint already
  guaranteed conformance at the parameter position; the resolver only needs
  the narrowing, which a cheap `Query extends Document` (or nothing) provides.
- `ResolveAccumulatorFunction` already follows the rule; the registry just
  formalizes it.

**How it's forced, not just encouraged:**

1. **By construction** — once dispatch is _derived_ from `ExpressionSpec` /
   `AccumulatorSpec`, there is no hand-written per-operator dispatch left to
   get wrong; new operators inherit key-first dispatch automatically.
2. **Conformance assertions** (Phase 0 file) pin the behavior:
   - `InferExpression<S, { $size: 12 }>` is `number` (forgiving dispatch — a
     wrong operand must not change the inferred kind);
   - `InferExpression<S, { notAnOp: 1 }>` is the `NotAnExpression` sentinel;
   - `InferExpression<S, { $add: [], $size: x }>` is the exactly-one-operator
     brand.
3. **Grep-able CLAUDE.md rule**: no `extends <Category>Expression<Schema>` or
   `extends XxxQuery<Schema>` in _inference/dispatch_ positions (constraint
   positions on Pipeline methods are exactly where they belong instead).
4. **Benchmark gate** catches reintroduced full-union dispatch as an
   instantiation-count regression.

### 3.5 Hoisting computed types into generic parameters

Two precedents already exist in the codebase and should become the standard:

- `GetFieldTypeWithoutArrays<Schema, Path, FullPath = Path>` — an
  **accumulator parameter** so the recursion doesn't recompute the original
  path for the error message.
- `Pipeline.lookup`'s `LocalFieldType extends GetFieldType<...>` — a
  **method-level inferred parameter** computed once and shared by the
  `ForeignField` constraint and the brand message.

A note on what hoisting actually buys: TS caches instantiations by
`(alias, type-args)`, so repeating an _identical_ alias call is mostly cache
hits, not full recomputation. The real wins are:

1. **Depth**: every `X extends infer Y ? ...` aliasing trick adds a
   conditional-nesting level toward the ~50 instantiation-depth limit (the
   limit this library already fights with hand-rolled "batched" expansion).
   A defaulted generic parameter is depth-free — the result is substituted.
2. **Eager-once evaluation**: a defaulted parameter is computed once at
   instantiation; each use site is then an O(1) reference instead of an
   alias resolution + cache lookup.
3. **Cache unification**: near-duplicate aliases (`HasInclusions` vs
   `HasInclusionNonId`) can never share a cache entry; hoisting one computed
   value into a shared parameter makes the sharing structural.
4. **Cross-position sharing**: a method-level inferred/defaulted generic is
   the only way for the _parameter_ position (validate) and the _return_
   position (resolve) to share one computation.

#### Pattern A — method-level generics shared between validate and resolve

`project` is the flagship: `HasInclusionNonId`/`HasExclusionNonId` (validate
side) and `HasInclusions`/`HasExclusions` (resolve side) are near-duplicate
pairs computed independently for every call. Consolidate to one pair and
hoist the mode:

```ts
project<const P, IncMode extends boolean = HasInclusions<P>,
                 ExcMode extends boolean = HasExclusions<P>>(
  $project: ValidateProjectQuery<PreviousStageDocs, P, IncMode, ExcMode>
): Pipeline<..., ResolveProjectOutput<PreviousStageDocs, P, IncMode, ExcMode>, ...>
```

Each mode is then computed once per call instead of twice (and the
near-duplicate alias pair collapses to one definition).

#### Pattern B — defaulted "cache" parameters on deep helpers

| Site                                                        | Today                                                                                                                                                                         | Hoist                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FieldReferencesThatInferTo<Schema, T>` (fieldReference.ts) | Re-maps the full `FieldReference<Schema>` union and re-filters per **each of ~10 distinct `T`** used across operands (`number`, `string`, `Date`, `unknown[]`, `number[]`, …) | `SchemaRefTypeMap<Schema> = { [K in FieldReference<Schema>]: InferFieldReference<Schema, K> }` computed **once per schema**; `FieldReferencesThatInferTo<Schema, T, M = SchemaRefTypeMap<Schema>>` filters the precomputed map. The single biggest recomputation sink in the library — every operand helper for every target type reuses one map. |
| `ExpectedValue<Schema, QueryKey, QueryValue>` (match.ts)    | `GetFieldType<Schema, QueryKey>` written in 4 arms                                                                                                                            | `ExpectedValue<…, FieldType = GetFieldType<Schema, QueryKey>>`                                                                                                                                                                                                                                                                                    |
| `MergeSetPlainObjects<Base, Updates>` (utils/core.ts)       | `ExcludeUndefined<Base>` written **8 times**                                                                                                                                  | `MergeSetPlainObjects<Base, Updates, BaseObj = ExcludeUndefined<Base>>`                                                                                                                                                                                                                                                                           |
| `ResolveSetOutput` (set.ts)                                 | `ResolveSetInlineSchema<Schema, Query>` written 3 times across branches                                                                                                       | hoist as defaulted param on an inner alias                                                                                                                                                                                                                                                                                                        |
| `ResolveUnsetOutput` / `RemoveFieldPaths` (unset.ts)        | `AllTopLevelPaths<Paths>` and `ExtractTopLevelKeys<Paths>` each computed in both the resolver and the helper                                                                  | compute once in the resolver, pass down as parameters                                                                                                                                                                                                                                                                                             |
| `RequiredUpdateKeys` / `OptionalUpdateKeys` (utils/core.ts) | Exact complements, each independently walking all of `Updates`                                                                                                                | one walk producing a classification map; derive both key sets from it                                                                                                                                                                                                                                                                             |

Caveat: defaulted parameters are evaluated **eagerly** at instantiation, so
they must sit _inside_ the `PassThrough` happy path (an inner alias), never
on the outer resolver — otherwise the error short-circuit pays for the
computation it exists to skip.

#### Pattern C — accumulator parameters to unlock tail-recursion elimination

TS raises the recursion limit from ~50 to ~1000 for **tail-recursive**
conditional types (the branch is directly the recursive reference). The
hand-rolled "batched 2-levels-at-a-time" machinery (`ExpandDottedKeyBatched`,
unset.ts's triple-nested base cases) exists purely to halve depth; an
accumulator-parameter formulation removes the need:

```ts
type SplitPath<S extends string, Acc extends string[] = []> =
  S extends `${infer Head}.${infer Tail}` ? SplitPath<Tail, [...Acc, Head]>
  : [...Acc, S]; // tail-recursive: ~1000-depth budget
```

Split once, then build/consume the segment tuple iteratively. Candidates:
`ExpandDottedKeyBatched` (+ its `PreservingOptional` variant),
`RemoveFieldPathBatched` (unset.ts — the 70-line triple-nested type collapses
to split + fold), `ExtractTopLevelKeys`/`ExtractNestedPathsForParent`.

#### What NOT to hoist: the `Pipeline` class itself

Tempting but rejected: caching `FieldSelector<PreviousStageDocs>` /
`FieldReference<PreviousStageDocs>` as new `Pipeline` class generics.
(a) Alias caching already makes the per-schema path enumeration a one-time
cost — methods reusing `FieldSelector<S>` for the same `S` hit the cache;
(b) every hover of a pipeline value would display the full path-union in the
type arguments — a major DX regression; (c) every new class generic must be
threaded through `_chain` and all ~20 method return types. Method-level
generics (Pattern A) capture the benefit without the cost.

### 3.6 Utils split

`utils/core.ts` splits along its existing seams (pure moves, no logic change),
plus the new `utils/dispatch.ts` from 3.4:

| New module          | Contents                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `utils/errors.ts`   | `PipeSafeError`, `IsPipeSafeError`, `PassThrough`, `RequiresMsg`                                                      |
| `utils/dispatch.ts` | `OperatorKeyOf` + tuple-guarded dispatch helpers (3.4)                                                                |
| `utils/strings.ts`  | `DollarPrefixed`, `WithoutDollar`, `NoDollarString`, `Alphabet`/`Digit`, `Join`, `IndexStr`                           |
| `utils/paths.ts`    | `ExpandDottedKey*`, `FlattenDotSet`, `HasDottedKeys`, `RemoveDottedKeys`, `ExpandAllDotted*`                          |
| `utils/objects.ts`  | `Document`, `Prettify`, `MergeNested`, `IsPlainObject`, `UnionToIntersection`, `ExclusifyUnion`, `NonExpandableTypes` |
| `stages/set.ts`     | `ApplySetUpdates` + its ~15 private helpers move next to their only consumer                                          |

All rows are pure moves except two additions — `RequiresMsg` and the
`utils/dispatch.ts` module — which are new code created in Phase 2.

`utils/core.ts` is **deleted**, not kept as a barrel — internal imports are
updated to the new modules. Nothing in the split is renamed, so it creates
no compat entries (3.7): `Document`, `Prettify`, `PipeSafeError`,
`IsPipeSafeError`, `PassThrough` stay public API via `index.ts`, which
simply re-points at the new module locations.

### 3.7 One compat file to delete at the next major

Every backwards-compatibility export created by this plan lives in **one
file**: `src/compat.ts`. The expected contents are small — exactly one
entry: the `MergeOptions` name (superseded by `MergeQuery`).

**Phase-3 amendment**: the originally-planned second entry — a compat alias
for `ResolveCountOutput`'s old single-parameter form — is **impossible**:
one exported name cannot carry two arities, and a legacy
`ResolveCountOutput<"total">` call cannot satisfy the new
`Schema extends Document` first parameter. The arity change ships as a
documented breaking change instead (acceptable pre-1.0; noted in the
changeset). The other parameter-order flips need no aliases because those
types are internal, and the remaining exported resolvers (`limit`, `skip`,
`sample`) are already schema-only and Schema-first, so they are unchanged. Module _paths_ need no compat
treatment either: the package's public surface is the root `index.ts`, so
moving a type between internal files (3.6) is invisible to consumers as
long as the root re-export remains.

Rules:

- Each alias carries `@deprecated` JSDoc naming its replacement and the
  removal milestone (`v1.0.0`).
- `index.ts` re-exports from `compat.ts` so the public surface is unchanged.
- **Nothing inside the package may import from `compat.ts`** — internal code
  uses only the new names. Enforced with an ESLint `no-restricted-imports`
  rule so violations fail the pre-commit hook, plus a conformance assertion
  that each alias stays identical to its replacement.
- Removal at the next major is then trivial: delete `src/compat.ts`, drop its
  `index.ts` re-export line, and add a `major` changeset listing the removed
  names (generated from the file's own exports).

### 3.8 Where a constraint lives: Query vs Validate

The trio gives every stage two places to check a query's validity. The
division of labor (each principle below traces to a measured behavior from
the PR #102 review; see §7.3/§7.4 for the numbers):

> **Query answers "what can I write?" — Validate answers "what did you get
> wrong?".** Query is the acceptance surface: permissive, cheap, and
> contextual-typing-friendly, because it is related against on EVERY call —
> including the all-valid common case — and it is what powers IDE
> autocomplete. Validate is the rejection surface: it re-checks the inferred
> literal and replaces offending values with brands.

Rules, in decision order:

1. **Check in the Query type when the key set is finite and schema-derived**
   (a mapped type over `FieldSelector<Schema>` etc.). TS's normal relation
   then lands on each value position, so value-position brands fire for free
   with no wrapper — this is the `match` model (`ComparatorMatchers`), and it
   is the cheapest strictness available. Prefer it wherever it works.
2. **Move the check to Validate when the Query type needs an index
   signature, a pattern index signature, or a permissive union arm to stay
   writable.** Those constructs suppress per-value checking _structurally_
   (`group`'s `[key: string]` index signature; `set`/`project` literals'
   `ObjectLiteral` pattern index — the §7.3 bug). No amount of brand-in-union
   inside the Query fixes that; the Query stays permissive by design and the
   Validate wrapper carries all the strictness for those positions.
3. **A constraint is spelled once — in the operand kernel — and referenced
   from both sides.** Query members reference the operand type for
   acceptance; Validate members reference the _same_ operand type for the
   `[Operand] extends [...]` re-check and build the brand from the same
   `RequiresMsg`. Never re-spell a constraint in a Validate type.
4. **Validate must not replace the inference/contextual-typing position.**
   The safe signature shapes are the generic constraint plus intersection
   (`<const Q extends XxxQuery<S>>($q: Q & ValidateXxxQuery<S, Q>)`) or
   `project`'s bare-wrapper form — the latter ONLY when the wrapper is
   homomorphic and no member depends on contextual typing (group's
   compound-`_id` is the counterexample: both bare-wrapper variants break it,
   §7.4).
5. **Validate pays only on failure.** Aim for "valid input maps to itself" —
   or better, key-filter so a fully-valid query validates against `{}` —
   so the happy-path relation short-circuits. The naive full-map
   intersection cost 3× whole-project check time (§7.4); that cost is a
   Validate-design smell, not an inherent price.
6. **Query types own the depth/instantiation budget.** They instantiate per
   call and recurse (`AnyLiteral`), so no full-union arms in deep recursive
   positions (`Expression<Schema>` inside `ObjectLiteral` = +26.6%
   whole-project, §7.3); use structural key-based acceptance
   (`ExpressionShaped`) at depth and leave operand strictness to the top
   level or the Validate layer.

Litmus test when adding a stage or operator: "does a wrong value produce a
brand at the chained call site?" If yes via the Query type alone, done (rule
1). If not, the strictness belongs in Validate (rule 2) — never in a more
permissive Query arm.

---

## 4. Phased execution plan

Each phase is a separate PR, gated by: `bun run build`, all
`*.typeAssertions.ts` green, `Pipeline.callSite.typeAssertions.ts` untouched or
strengthened (never weakened), and `packages/core/benchmarking` instantiation
counts within noise of the previous baseline.

**Gate mechanics (Phase-3 amendment)**: assertions are validated by
**per-package** `tsc --noEmit` (`cd packages/core && bunx tsc --noEmit`,
same for manifold) — the root `bun run typecheck` resolves project
references to built `dist/` declarations and therefore does NOT re-check
`packages/*/src`. Manifold's gate additionally requires a fresh
`bun run build` of core first, for the same reason. Changesets: phases 1–5 are
`patch` (internal); phase 6 is `minor` if any new public types are exported.

### Phase 0 — Pin current behavior (the safety net)

- Add `stages/stages.contract.typeAssertions.ts`: per-stage PassThrough
  assertions, per-stage "Pipeline method uses the module's types" assertions.
  Expect this to **fail** for `count` (no PassThrough), and to make the
  `sort`/`unwind` wiring gaps visible — mark those with
  `ExpectAssertFailure`/TODO so the gap is recorded before it's fixed.
  Note: these assertions are written against the **current** signatures
  (today's parameter orders); Phase 3 updates them to the `<Schema, Q>`
  convention in the same PR that flips the signatures.
- Add the dispatch-semantics assertions from 3.4 (forgiving inference, the
  `NotAnExpression` sentinel for `$`-less objects, exactly-one-operator
  brand) — these pin **target** semantics, not current ones, so all three
  are `ExpectAssertFailure` until Phase 4 lands; the point is to declare
  the intended behavior up front.
- Record benchmark baseline numbers in the PR description.

### Phase 1 — Dead code and drift fixes (small, high-value)

- Delete `elements/arrayOperator.ts`; delete `MatcherThatOnlyDoesEquals`,
  `ElementResolvingToType`, `ArrayResolvingToType` (or move to a quarantine
  file if Manifold examples touch them — verify first).
- Wire `Pipeline.sort` to `ResolveSortOutput`; wire `Pipeline.unwind` to
  `UnwindQuery`/`UnwindPath` so the documented `$unwind` brand actually fires
  at chained call sites (add a callSite assertion for it). Both types are
  internal (not exported from `index.ts`), so this is non-breaking. Flip the
  corresponding Phase-0 `ExpectAssertFailure` markers here — only `count`'s
  stays red until Phase 3.
- Replace lookup.ts's `StartingDocs extends any ?` with the standard
  `extends unknown ?` distribution idiom + comment (3.3 rule 2).
- Remove the local `NonNullable` shadow in `expressions.ts`.
- Prune the unused `ExpandAllDotted` variant and convert "Stage N.M"
  optimization-log comments into a single short note (history lives in git).

### Phase 2 — Shared kernels

- Create `utils/errors.ts` (`RequiresMsg`), `elements/operands.ts`
  (`FieldOperand`, `ExpressionOperand`), and `utils/dispatch.ts`
  (`OperatorKeyOf` + tuple-guarded dispatch helpers from 3.4).
- Migrate match.ts, group.ts, expressions.ts operand helpers onto the kernel.
  Hover text must remain byte-identical — assert the exact brand messages in
  the existing typeAssertions before/after.
- Retrofit the two registry-independent early-exit wins:
  `InferNestedFieldReference`'s tier-2 `$`-key check before
  `Obj extends Expression<Schema>`, and `ResolveMatchOutput`'s
  `keyof Query & ("$and" | "$or" | "$nor")` split instead of the full
  `RawMatchQuery<Schema>` re-match. Both are hot paths; expect measurable
  instantiation-count improvements (record them against the baseline).
- Execute the utils split (3.6) as pure moves. Create `src/compat.ts` (3.7)
  with its `no-restricted-imports` lint rule here — initially empty, since
  its two entries (count's old resolver form, `MergeOptions`) only arise
  when Phase 3 renames them.
- Add the branded `GetFieldTypeOrError<Schema, Path>` sibling (3.3 rule 4)
  alongside the kernel, for user-surfacing call sites.

### Phase 3 — Stage trio standardization

- Normalize names and parameter order (`<Schema, Q>`) across all stage files
  and their `Pipeline` call sites. Almost all of these types are internal;
  of the exported ones, `limit`/`skip`/`sample` resolvers are already
  schema-only and Schema-first (unchanged), leaving only `count` and
  `MergeOptions` needing compat aliases (3.7).
- Fix the `count` PassThrough hole (F2) here, not in Phase 1: the fix changes
  the **exported** `ResolveCountOutput` to `<Schema, FieldName>`, which needs
  a compat alias and therefore Phase 2's `compat.ts`. The Phase-0
  `ExpectAssertFailure` marker for `count` stays red until this lands.
- Consolidate the duplicate projection-mode pairs and hoist the mode into
  `Pipeline.project`'s method-level generics (3.5 Pattern A) — this phase
  already touches every signature, so the hoist rides along.
- Rename `StartingDocs` → `Schema` inside lookup/unionWith/graphLookup stage
  files (cosmetic, but it currently misstates which schema flows in).
- Drop the redundant full `Query extends SetQuery<Schema>` /
  `ProjectQuery<Schema>` re-checks inside resolvers (3.4): the Pipeline
  method's generic constraint already proved conformance at the parameter
  position.
- Flip the last Phase-0 stage-contract `ExpectAssertFailure` marker
  (`count`'s) to a real assertion — sort/unwind's were already flipped in
  Phase 1 — and update the contract assertions to the new `<Schema, Q>`
  signatures, per the Phase-0 note.

### Phase 4 — Registry containers

- Rebuild `expressions.ts` around `ExpressionSpec<Schema>` (section 2,
  recommendation 1)
  with **operator-key dispatch as the only dispatch mechanism** (3.4):
  derive `Expression`, category views, and the fixed-return arm of
  `InferExpression` from the registry; delete `InferExpressionType`; route
  `$ifNull`/`$cond` operand inference through the single dispatch. Flip the
  Phase-0 dispatch-semantics `ExpectAssertFailure` markers (forgiving
  inference, one-operator brand) to real assertions. This phase carries the
  most diagnostic-display risk — review every changed hover in
  `set.typeAssertions.ts` / `project.typeAssertions.ts` with
  `.claude/inspect-types.ts`.
- Rebuild `group.ts` accumulators around `AccumulatorSpec<Schema>` the same
  way. (This may also unlock the documented `Pipeline.group` call-site brand
  limitation, but treat that as a stretch goal, not a gate.)

### Phase 5 — Depth & recomputation (parameter hoisting, 3.5)

Separate phase because each item is mechanical but must be individually
benchmarked — hoisting is a performance refactor and lives or dies by the
instantiation counts.

- **Pattern B retrofits**, in expected-impact order:
  `SchemaRefTypeMap` parameter on `FieldReferencesThatInferTo` (one
  ref→type map per schema instead of a re-filter per target type);
  `ExpectedValue`'s `FieldType` parameter; `MergeSetPlainObjects`'
  `BaseObj` parameter; `ResolveSetOutput`'s hoisted inline schema;
  unset's `AllTopLevelPaths`/`ExtractTopLevelKeys` passed down instead of
  recomputed; merge `RequiredUpdateKeys`/`OptionalUpdateKeys` into one walk.
- **Pattern C conversions**: tail-recursive `SplitPath` accumulator replacing
  `ExpandDottedKeyBatched` (+ `PreservingOptional` variant) and unset's
  `RemoveFieldPathBatched`; delete the hand-rolled batching machinery once
  depth headroom is confirmed on the deep-nesting benchmark cases.
- Keep defaults inside the `PassThrough` happy path (3.5 caveat) — add a
  contract assertion that an error schema short-circuits without evaluating
  the hoisted defaults (observable via instantiation counts on the error
  path).

### Phase 6 — Documentation

- Replace the relevant CLAUDE.md sections with the conventions in section 3
  (trio naming, operand kernel, early-exit/distribution rules, the
  operator-key dispatch standard, the parameter-hoisting patterns, the
  compat-file rule, and the explicit "stages get conventions, expressions
  get registries" decision).
- Document the selector/reference `never`-vs-brand asymmetry (F7) at both
  definitions.

---

## 5. Risks and mitigations

| Risk                                          | Mitigation                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error/hover display regressions (the product) | Brand messages asserted byte-for-byte in typeAssertions; `callSite.typeAssertions.ts` never weakened; `inspect-types.ts` spot checks in Phase 4 review.                                                                                                                                                                                            |
| Type-instantiation count regressions          | Benchmark gate per phase against the Phase-0 baseline.                                                                                                                                                                                                                                                                                             |
| Registry indirection worsening hovers         | Registry is internal only — user-facing parameter types remain plain (`Expression<Schema>` stays a union alias); if a derived union displays worse than the hand-written one, fall back to hand-written union + registry-driven conformance assertion instead.                                                                                     |
| Public API breakage                           | Only `limit`/`skip`/`sample`/`count` resolvers, `MergeOptions`, `SampleQuery` and the `utils/core` quintet are exported. The quintet isn't renamed — `index.ts` just re-points at the new modules. The renamed/reordered ones keep `@deprecated` aliases until next major, isolated in `src/compat.ts` (3.7) so removal is a single file deletion. |
| Hoisted defaults computed on error paths      | 3.5 caveat: defaults live on inner aliases behind `PassThrough`; pinned by a contract assertion in Phase 5.                                                                                                                                                                                                                                        |

---

## 6. Decisions from the A/B implementation comparison

The plan was implemented twice — attempt A exactly as specified
(`claude/gallant-newton-yrvl9i-attempt-a`), attempt B varying the three parts
the spec flagged as having alternatives
(`claude/gallant-newton-yrvl9i-attempt-b`) — then consolidated. Both attempts
were fully green (per-package `tsc`, build, lint, 56/56 tests, identical brand
messages and dispatch semantics, clean hovers).

| Whole-project instantiations | anchor  | attempt A        | attempt B        | consolidated         |
| ---------------------------- | ------- | ---------------- | ---------------- | -------------------- |
|                              | 990,220 | 637,808 (−35.6%) | 598,225 (−39.6%) | **599,838 (−39.4%)** |

**Confounding correction**: the consolidated tree (registry-DERIVED types +
B's variations 2–3) measures within noise of attempt B — so the A↔B gap was
caused almost entirely by variations 2–3 (the eager `ExpectedValue` default
and the method-level projection hoist, ~38K together), **not** by
derived-vs-hand-written types (~+1.6K, ~0.3%, noise). Attempt B varied three
things at once; the consolidated run is the controlled experiment.

**Consolidated tree = attempt A's registry derivation + attempt B's
variations 2–3**, with these per-part verdicts:

1. **Expression/accumulator types: registry-DERIVED (attempt A) — maintainer
   decision, vindicated by the controlled measurement.** Initially the
   hand-written + conformance variant appeared ~6% cheaper, but the
   consolidated run shows that gap belonged to variations 2–3 (see the
   correction above): derived-vs-hand-written is ~0.3% (noise). A depth probe
   additionally showed zero depth cost (identical breaking depth of 50 in
   validation; 999+ levels clean in inference — the derivation resolves once
   per schema and is alias-cached). Deriving from the registry means one edit
   site per operator and **no conformance file to keep up to date**, at
   essentially no compile cost. The hand-written variant remains on
   `claude/gallant-newton-yrvl9i-attempt-b` for the record.
2. **Method-level projection-mode hoist (Pattern A): dropped.** Measured
   _worse_ than defaulted parameters on the two types: the cross-position
   sharing rationale was wrong — the resolve position's default is an
   alias-cache hit of the validate position's computation. The consolidated
   NonId mode pair (and its `{_id: 1, name: 0}` bugfix) stays.
3. **`ExpectedValue` FieldType hoist (Pattern B row 2): dropped, measured
   neutral.** Conditional arms are lazy and repeats alias-cached; the
   parameter bought nothing.
4. Everything else (phases 0–3, dispatch kernel and semantics, utils split,
   operand kernel, post-distribution `SchemaRefTypeMap`, tail-recursive
   `SplitPath`/`RemoveAtSegments`, set/unset hoists, compat rule, docs) was
   identical in both attempts and carries through unchanged.

Spec corrections discovered during implementation (amended in place above):
the per-package `tsc` gate (§4), the count compat-alias impossibility (§3.7),
the union-distribution unsoundness of defaulted schema-derived parameters
(§3.5 — see `SchemaRefTypeMap`), and additional dead types (F5).

---

## 7. Post-review follow-up plan

Decisions from the independent review of PR #102 (July 2026). The review
reproduced the §6 numbers (base 988,155 / attempt A 637,808 exact / attempt B
598,225 exact / derived flip 599,838 exact; final head 560,234 = −43.3%,
better than the claimed −39.4% thanks to the post-consolidation review
commits) and stress-tested the four core decisions with built-and-measured
alternatives. All measurements below are from real runs on TS 5.9.3
(`tsc --noEmit -p tsconfig.benchmark.json --extendedDiagnostics`, dist built;
instantiation counts were deterministic across runs; wall times on the review
box carry ±0.5s noise).

Priority order: 7.1 (CI gate) → 7.5 (missing pins) → 7.3 (ObjectLiteral bug)
→ 7.4 (group validation) → 7.2 (trio completion, rides along with 7.3/7.4).

### 7.1 CI gate — make the regression net automatic (BLOCKING follow-up)

**Finding**: neither CI nor the lefthook pre-commit executes the
`*.typeAssertions.ts` files. `bun run build` is tsdown (a bundler, no full
type check), root `bun run typecheck` resolves project references to built
`dist`, and the tests are runtime-only. Proven end-to-end during review: a
brand-message edit ("a numeric or date field" → "a number or date field")
passed build, lint, root typecheck, and all 56 tests; only per-package
`tsc --noEmit` caught it. Every "enforced by assertions" claim in this
document is conditional on a command that today runs only when a developer
remembers to type it.

Work items:

1. Add a CI job (and a lefthook command) running per-package `tsc --noEmit`
   for core, and for manifold after a fresh core build (the §4 gate
   mechanics, automated).
2. Optional but recommended: a benchmark budget check — fail CI if
   whole-project instantiations exceed ~600k + agreed slack. This is the only
   automatic enforcement the §3.4 dispatch standard can have: the review
   showed that re-introducing a single full-union membership test on the hot
   path (`Obj extends Expression<Schema>` in `InferNestedFieldReference`)
   costs +44,659 instantiations (+8.0%) while the entire assertion suite
   stays green — grep and review are currently the only guards.

### 7.2 Trio completion — Query everywhere, Validate as a growth axis

Maintainer decision: the trio should be uniformly present, DRY, with the
missing members added as future feature work rather than left as sanctioned
gaps.

1. **`XxxQuery` for scalar stages.** `limit`, `skip`, and `count` currently
   take inline scalars. Each stage module exports its Query alias
   (`LimitQuery = number`, `SkipQuery = number`, `CountQuery = string` — no
   `Schema` parameter, per the amended 3.1 table) and the Pipeline method
   parameter references the module's type. Add "method uses the module's
   Query type" wiring pins to `stages.contract.typeAssertions.ts` for the
   scalar stages (same drift class as F2/F5's sort/unwind gaps).
2. **`ValidateXxxQuery` members are planned feature adds, not exceptions.**
   The validation layer grows per stage by _pulling from_ the existing Query
   building blocks and the operand kernel — a Validate member re-uses the
   same operand types the Query/registry declares (e.g. §7.4's
   `ValidateAccumulator` re-uses `NumericAccumulatorOperand`), so the
   constraint is written once and both the acceptance surface and the
   branded-rejection surface derive from it. Never re-spell a constraint
   inside a Validate type. §3.8 records the full Query-vs-Validate division
   of labor these additions must follow.
3. Order of addition: `group` (§7.4, fixes the documented known limitation),
   then expression-position operand validation for `set`/`project` — whose
   feasible strictness depends on the §7.3 outcome.

### 7.3 `ObjectLiteral` accepts `$`-keyed objects — existing bug, fix it

**Finding (pre-existing at the PR's base, confirmed by probe)**: a
`$`-keyed object is vacuously assignable to `ObjectLiteral` because its
mapped key is the template pattern `NoDollarString` — TS does not constrain
properties that don't match a pattern index signature. Consequences,
all verified on head:

- `.set({ total: { $add: ["$name", 1] } })` (bad operand) compiles silently —
  the expression fails the `Expression<Schema>` arm and falls into the
  literal arm. The `ExpressionOperand` brands are therefore unreachable from
  chained `$set`/`$project`/`$group` call sites; they fire only under
  explicit annotation (match's field-position brands are unaffected).
- **Valid nested expressions ride on the same hole**:
  `.set({ meta: { computed: { $add: ["$age", 1] } } })` type-checks _only_
  because of the vacuous path — `ObjectLiteral`'s value union does not
  include `Expression<Schema>`. Any fix must add a legitimate route for
  nested computed values or it breaks working code.

Maintainer decision: treat as a bug; the `$`-keyed object must not be
accepted as a literal itself. Two fix shapes were prototyped and measured
(both: full assertion suite green after moving one `@ts-expect-error` in
`Pipeline.examples.ts` whose error position shifts one line; 56/56 tests):

| Option         | Shape                                                                                                | Cost vs head (560,234) | Semantics                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — strict     | `ObjectLiteral` value union += `Expression<Schema>`; intersect `& { [K in \`$${string}\`]?: never }` | **+149,279 (+26.6%)**  | Bad operands rejected at every depth today                                                                                                              |
| B — structural | value union += `ExpressionShaped` (`{ [K in \`$${string}\`]: unknown }`); same `$`-key guard         | **+69,757 (+12.5%)**   | Top-level bad expressions rejected (strict union check); nested bad _operands_ still pass structurally — validation deferred to the §7.2 Validate layer |

Recommendation: **option B** as the bug fix (it closes "a `$`-keyed object
is a literal" at every depth, at half the cost), with operand strictness
arriving via the Validate layer rather than the recursive literal union —
that matches the §3.4 philosophy (classify by key cheaply; validate
separately). Option A is the fallback if per-stage Validate members stall.

Open items for the implementing PR:

- Spike a cheaper encoding before settling: a single mapped type over
  `NoDollarString | \`$${string}\`` with a key-conditional value type may
  relate cheaper than the intersection; also consider hoisting strictness
  into the stage Query value unions instead of the recursive literal.
- Error quality on rejection is rough: the bad value reports against the
  full `"$$REMOVE" | AnyLiteral | Expression` union and can surface as
  TS2589 (excessively deep) on the statement — same class as the documented
  `$naem` behavior in `Pipeline.callSite.typeAssertions.ts`. Acceptable for
  the bug fix (silent acceptance is worse); brands come with the Validate
  layer.
- Add callSite pins: bad-top-level-expression and bad-nested-expression
  cases for `set` (and project), marked TODO where option B intentionally
  defers them.
- `ResolveToPrimitiveObject` (group `_id` position) needs the same audit.

#### 7.3 addendum (implemented): the TS2589 rejection noise, root-caused and fixed

The "rejections can surface as TS2589" caveat was root-caused with bisection
probes and PR #99's depth-viewer, then fixed:

- **Root cause**: no single type was too deep. The resolver applied to the
  const-inferred literal, the resolver applied to the widened constraint,
  and every union-member relation were each individually clean; the TS2589
  appeared only in the real failing call's context, where inference,
  constraint elaboration through the deep `AnyLiteral | Expression` union,
  and return-type instantiation share ONE cumulative instantiation stack.
  (Empirically it required: `const` generic + `ResolveSetOutput` in the
  return type + the failing relation — remove any one and the 2589
  vanishes.)
- **Fix (§3.8 rules 2/5/6 applied to `set`)**: `SetQuery` accepts
  `$`-strings and `$`-keyed objects STRUCTURALLY (shallow — nothing deep to
  explore on failure), and the key-filtered `ValidateSetQuery` intersection
  re-checks them: unknown refs brand with the existing Field message,
  multi-`$`-key objects with the exactly-one-operator brand, unknown
  operators with `Operator '<op>' is not a known expression operator.`, and
  known-operator/invalid-operand values are mapped to the registry's
  expected shape (`ExpressionFor<Schema, Op>`) so TS reports TS2322 at the
  offending operand against the operand kernel's branded union.
- **Result**: zero TS2589 across all rejection probes; every `set`
  rejection is now a single correctly-positioned TS2322 (previously: a
  union-wall TS2322 plus a spurious statement-level TS2589). Cost:
  +42,860 whole-project instantiations (+6.6%), check time unchanged
  (~3.1s); depth-viewer attribution: `ValidateSetQuery` 182 +
  `ValidateSetValue` 86 owned registry entries, `ExpressionFor` +1.
- **Remaining**: `project` should get the same treatment when its
  expression-position Validate member lands (§7.2); nested-in-literal
  operand strictness is still the standing TODO pin.

### 7.4 Group accumulator validation — fix the known limitation

Maintainer decision: fix it. Review findings that reframe the CLAUDE.md
"known limitation" paragraph (update it when this lands):

- The PR head itself type-checks clean; compound-`_id` was never broken on
  the branch. The breakage appears only when `Pipeline.group`'s parameter is
  _wrapped_ — re-verified unconfounded on pristine head.
- The **project-style wrapper** (`$group: ValidateGroupQuery<S, G>`) breaks
  compound-`_id` exactly as documented (TS2589 + the `_id` value failing
  `AnyLiteral | Expression | null` once contextual typing is lost). A
  variant giving `_id` a concrete contextual type
  (`K extends "_id" ? AnyLiteral<Schema> | Expression<Schema> | null : ...`)
  **also fails** — recorded so nobody re-tries it naively.
- The **intersection form works**:

  ```ts
  group<const G extends GroupQuery<PreviousStageDocs>>(
    $group: G & ValidateGroupQuery<PreviousStageDocs, G>
  )
  ```

  With `ValidateAccumulator` re-using `NumericAccumulatorOperand` and
  branding the offending value
  (`Type '"$name"' is not assignable to type '"$name" &
PipeSafeError<"Accumulator '$sum' requires a numeric operand.">'`),
  compound-`_id` keeps compiling, the full suite stays green, 56/56 tests.
  **Cost**: +48k instantiations (+8.6%) but **check time 3.7s → 11s and
  memory 290MB → 670MB** — instantiation counts and wall time diverge badly
  on intersections of large literal types; do not gate this work on
  instantiations alone.

Spike list to kill the time/memory blowup (acceptance gate: brand fires,
compound-`_id` compiles, whole-project check time within ~10% of baseline,
suite green):

1. Attribute first: `tsc --generateTrace` on the intersection variant to
   find where the 7s go (suspect: relating every group literal against the
   intersection re-explores `FieldReferencesThatInferTo` per call).
2. Early exit: only wrap when validation can matter —
   `HasNumericAccumulatorKey<G> extends true ? G & ValidateGroupQuery<...> : G`
   at the parameter, or key-remap the Validate type to touch only
   `$sum`/`$avg`-carrying keys and intersect with the untouched remainder.
3. Hoist a per-schema precomputed operand union (the `SchemaRefTypeMap`
   pattern, §3.5) so the per-call relation is against an alias-cached union.
4. Fallback if parameter-position stays too expensive: brand at the
   _return_ position (resolver yields `PipeSafeError` output for an invalid
   operand — surfaces on the next chained call; weaker UX, zero
   parameter-position cost).

### 7.5 Missing assertions found by the review

1. **Hot-path forgiving dispatch is unpinned**: reverting
   `InferNestedFieldReference` to the full-union style left the entire suite
   green (only the benchmark moved). Add an assertion that a malformed
   expression _nested in a `$set` value_ still infers the operator's declared
   result kind (e.g. `{ n: { $dateToString: { format: 1, date: "$ts" } } }`
   resolves `n: string`).
2. **Compat-alias equality** (§3.7 promised it; it was never written): assert
   `Equal<MergeOptions<T>, MergeQuery<T>>` so the alias can't drift.
3. **Expression-position callSite pins** (§7.3): today's silent acceptances
   documented as TODO pins so the guard file is honest about what fires.

### 7.6 Alternatives tested and REJECTED during the review (decision log)

Recorded so future refactors don't re-litigate them without new evidence.
Baseline: head 560,234 instantiations.

| Alternative                                                                                         | Result                                                                                                                            | Verdict                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container record per stage (`MatchStage<S, Q>["query"/"output"]`, match + project)                  | +224 (+0.04%); call-site errors and hovers byte-identical                                                                         | The §2 rejection stands, but for the right reasons: it buys no reuse without HKTs and rags across stages — the predicted perf/diagnostics costs do NOT materialize |
| Hand-written expression unions + conformance file (attempt B variant)                               | −1,613 (−0.27%); 5 registration sites + 180-line conformance file vs 1 registry entry                                             | §6 verdict re-confirmed by single-commit isolation (fbdac84 → 32b9bde)                                                                                             |
| Key-remapped mapped-type dispatch in `InferExpression` (`{ [K in OperatorKeyOf<Expr>]: ... }[...]`) | **−53,222 (−9.5%)**, full parity on errors/hovers/tests — but nested-`$cond` depth budget HALVED (breaks ~17–20 vs ~31–33 levels) | Rejected: depth is scarcer than instantiations here. Any future dispatch-encoding change must include a depth probe                                                |
| Same mapped encoding for `ResolveAccumulatorFunction`                                               | +28k over the expression-only variant                                                                                             | The win is site-specific, not a general rule                                                                                                                       |
| `infer Op extends keyof Spec` ladder variant                                                        | −604 (noise)                                                                                                                      | No reason to change                                                                                                                                                |
| Unified single operand primitive (mode-flag merge of `FieldOperand`/`ExpressionOperand`)            | +47 (noise)                                                                                                                       | Two primitives are the honest factoring; a mode flag replaces two good names with one worse one                                                                    |
