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

| Export                        | Required                                                         | Notes                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `XxxQuery<Schema>`            | yes (unless the stage takes a scalar, e.g. `limit`)              | Rename `MergeOptions` → `MergeQuery` (public `MergeOptions` alias kept in compat, 3.7); fold `UnwindOptions` into `UnwindQuery`. |
| `ValidateXxxQuery<Schema, Q>` | only when the stage uses the validation-mapped signature pattern | Currently only `project`; `group`'s known limitation (CLAUDE.md) is the candidate follow-up.                                     |
| `ResolveXxxOutput<Schema, Q>` | yes                                                              | Must wrap its body in `PassThrough<Schema, ...>`. Terminal stages (`out`, `merge`) are exempt and say so in a doc comment.       |

Standard generic names: `Schema` for the incoming docs (replace
`StartingDocs`/`PreviousStageDocs` inside stage files), `Q` for the literal
query, `Foreign` for joined schemas. Two sanctioned deviations: schema-free
queries (e.g. `SampleQuery`) take no `Schema` parameter, and trailing
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
file**: `src/compat.ts`. The expected contents are small — exactly two
entries: `ResolveCountOutput`'s old single-parameter form (`<FieldName>`,
superseded by `<Schema, FieldName>`) and the `MergeOptions` name
(superseded by `MergeQuery`). The other parameter-order flips need no
aliases because those types are internal, and the remaining exported
resolvers (`limit`, `skip`, `sample`) are already schema-only and
Schema-first, so they are unchanged. Module _paths_ need no compat
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

---

## 4. Phased execution plan

Each phase is a separate PR, gated by: `bun run build`, all
`*.typeAssertions.ts` green, `Pipeline.callSite.typeAssertions.ts` untouched or
strengthened (never weakened), and `packages/core/benchmarking` instantiation
counts within noise of the previous baseline. Changesets: phases 1–5 are
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
