# PipeSafe Error-DX Synthesis

Aggregating findings from `_taxonomy.md` (ArkType scout) and 15 per-library audits across the TypeScript ecosystem (Drizzle, Effect, gql.tada, HotScript, io-ts, Kysely, TanStack Router, tRPC, ts-pattern, type-plus, TypeBox, Typia, Valibot, viem, Zod). Goal: identify which type-level error-DX techniques are battle-tested at scale and translate the most relevant ones into concrete proposals for pipesafe's pain-point files.

---

## 1. Executive summary

The audit confirms a clear consensus across query-builder/codec libraries: invalid input should be replaced by a **branded error interface** (`__brand: TMessage`) embedded into the offending parameter slot, not silently degraded to `never`. Drizzle's `DrizzleTypeError<E>`, Kysely's `KyselyTypeError<E>`, tRPC's `TypeError<TMessage>`, TanStack Router's `SerializationError<TMessage>`, and type-plus's `$Error<M, T>` are all variants of the same pattern (T1). They are paired almost universally with **hover-flattening** (`Prettify`/`Simplify`/`Expand`/`show` — T10) and **constraint-side validation** (T6). High-end libraries (ArkType, ts-pattern) layer **state-machine accumulators** (T3) on top to track context across builder calls.

PipeSafe's current pain points (`match.ts`, `fieldReference.ts`, `set.ts`, `group.ts`, `Pipeline.ts`) all suffer the same antipattern: invalid input degrades to `never` or `any`, producing the canonical bad TS error "type 'X' is not assignable to type 'never'". The headline recommendation is therefore to introduce a single `PipeSafeError<Msg, Ctx>` type (modelled on Kysely + type-plus) and replace the worst silent-`never` sites first: the `ComparatorMatchers<T>` operator-mismatch site, `InferFieldReference`'s missing-path return, and `set()`'s dotted-key conflict resolution. After that, T10 `Prettify` should be applied throughout to rescue hover readability.

What pipesafe should do first: ship Pilot A (typed operator errors in `match.ts`) — small, isolated, proves the pattern. Then Pilot B (typed path errors in `fieldReference.ts`).

---

## 2. Adoption matrix

Columns are libraries (ArkType included as scout). Rows are taxonomy categories T1–T15 plus the two extensions (T16 `$Distributive` control, T17 predicate-composition trees) that type-plus added.

Legend: ✓ used, ◐ partial/borderline, ✗ not used.

| ID  | Technique                              | ArkType | Drizzle | Effect | gql.tada | HotScript | io-ts | Kysely | TS-Router | tRPC | ts-pattern | type-plus | TypeBox | Typia | Valibot | viem | Zod |
| --- | -------------------------------------- | ------- | ------- | ------ | -------- | --------- | ----- | ------ | --------- | ---- | ---------- | --------- | ------- | ----- | ------- | ---- | --- |
| T1  | Typed Error Returns                    | ✓       | ✓       | ◐      | ✗        | ✗         | ✗     | ✓      | ✓         | ✓    | ◐          | ✓         | ◐       | ✓     | ✗       | ✓    | ✗   |
| T2  | Template-Literal Positional Errors     | ✓       | ◐       | ◐      | ✗        | ◐         | ✗     | ✓      | ✓         | ✗    | ✗          | ✗         | ✗       | ✗     | ✗       | ◐    | ✗   |
| T3  | State-Machine Error Finalization       | ✓       | ◐       | ✗      | ✓        | ✗         | ✗     | ✗      | ✓         | ✗    | ✓          | ✗         | ✗       | ✗     | ✗       | ✗    | ✗   |
| T4  | Conditional Return-Type Degradation    | ✓       | ✓       | ✓      | ✓        | ✓         | ◐     | ✓      | ✓         | ✓    | ✓          | ✓         | ✓       | ✓     | ✓       | ✓    | ✗   |
| T5  | Overload Ladders + Inference Recovery  | ✓       | ✓       | ✗      | ✓        | ✓         | ✓     | ✓      | ✓         | ✗    | ✓          | ✗         | ✗       | ✓     | ✓       | ◐    | ✗   |
| T6  | Constraint-Side Validation             | ✓       | ✓       | ✓      | ✓        | ✓         | ✓     | ✓      | ✓         | ✓    | ✓          | ✓         | ✓       | ◐     | ✓       | ✓    | ✓   |
| T7  | Inference Capture via `infer`          | ✓       | ✓       | ✓      | ✓        | ✗         | ✗     | ◐      | ◐         | ✗    | ✓          | ✓         | ✗       | ✗     | ✓       | ✓    | ✗   |
| T8  | String DSL Parser w/ Scanner FSM       | ✓       | ✗       | ✗      | ✓        | ✗         | ✗     | ✓      | ✓         | ✗    | ✗          | ✗         | ✗       | ✗     | ✗       | ✗    | ✗   |
| T9  | Phantom-Parameter Error Messages       | ✓       | ✓       | ✗      | ✗        | ✗         | ✗     | ✓      | ✗         | ✓    | ✓          | ✗         | ✗       | ✗     | ✗       | ✗    | ✗   |
| T10 | Hover-Flattening (`show`/`Prettify`)   | ✓       | ✓       | ✓      | ✓        | ✓         | ✗     | ✓      | ✓         | ✓    | ✗          | ✓         | ✗       | ✗     | ✗       | ✓    | ✓   |
| T11 | Branded/Phantom Symbols                | ✓       | ✓       | ✓      | ✓        | ✓         | ✓     | ✓      | ◐         | ✓    | ◐          | ✓         | ✓       | ✓     | ✓       | ✓    | ◐   |
| T12 | JSDoc Deprecation Markers              | ✓       | ✓       | ✓      | ✗        | ✗         | ◐     | ✓      | ✓         | ✓    | ✗          | ✗         | ✗       | ✓     | ✗       | ✓    | ✓   |
| T13 | Error Accumulation (short-circuit)     | ✓       | ✗       | ✓      | ✗        | ✗         | ✓     | ✗      | ✗         | ✗    | ✓          | ◐         | ✗       | ✓     | ✗       | ✗    | ✓   |
| T14 | Generic Context Binding Errors         | ✓       | ✗       | ✗      | ✗        | ✗         | ◐     | ✗      | ✗         | ✗    | ✗          | ✗         | ✗       | ◐     | ✗       | ✗    | ◐   |
| T15 | Declaration Mismatch Objects           | ✓       | ✗       | ✗      | ✗        | ✗         | ✗     | ✗      | ✗         | ✗    | ✗          | ✗         | ✗       | ✗     | ✗       | ✗    | ✗   |
| T16 | Distributive Control (type-plus ext.)  | ✗       | ✗       | ✗      | ✗        | ✗         | ✗     | ✗      | ✗         | ✗    | ✗          | ✓         | ✗       | ✗     | ✗       | ✗    | ✗   |
| T17 | $ResolveBranch composition (type-plus) | ✗       | ✗       | ✗      | ✗        | ✗         | ✗     | ✗      | ✗         | ✗    | ✗          | ✓         | ✗       | ✗     | ✗       | ✗    | ✗   |

---

## 3. Technique deep-dive

### T1 — Typed Error Returns (8 libraries: ArkType, Drizzle, Kysely, TS-Router, tRPC, type-plus, Typia, viem)

Definition: instead of returning `never` on invalid input, return a branded interface whose generic parameter carries a literal-string error message. Hover surfaces the string; the brand prevents accidental assignability.

- ArkType: `ErrorMessage<msg & ZeroWidthSpace>` (`ark/util/errors.ts:41-42`)
- Drizzle: `interface DrizzleTypeError<T extends string> { $drizzleTypeError: T }` (`src/utils.ts:174-176`)
- Kysely: `interface KyselyTypeError<E extends string> { __kyselyTypeError__: E }` (`src/util/type-error.ts:1`)
- tRPC: `type TypeError<M extends string> = M & { _: typeof _errorSymbol }` (`packages/server/src/unstable-core-do-not-import/types.ts:120-121`)
- TanStack Router: `interface SerializationError<TMessage extends string> { [SERIALIZATION_ERROR]: TMessage }` (`packages/router-core/src/ssr/serializer/transformer.ts:148-150`)
- type-plus: `$Error<M extends string, T = unknown>` carries both message and the offending type (`packages/type-plus/src/$type/errors/$error.ts`)
- viem: `type ErrorType<name extends string = 'Error'> = Error & { name: name }` (`src/errors/utils.ts:3`)
- Typia: discriminated `IValidation<T>` union with `IFailure.errors: IError[]` (runtime, but the *type* is structured)

TS-perf cost: low. All are shallow intersections; no recursion until used in a conditional.

Applicability scores (1-5):
- match.ts: 5 — slot it into `ComparatorMatchers<T>` to flag wrong operators
- fieldReference.ts: 5 — return `FieldRefError<msg, schema>` instead of `never`
- set.ts: 5 — flag dotted-key conflicts and unknown keys explicitly
- group.ts: 4 — flag wrong aggregator operand types
- Pipeline.ts: 3 — flag stage-ordering mistakes when wrapped with T9

Net recommendation: **adopt as the foundational primitive**. Introduce one canonical `PipeSafeError<M extends string, Ctx = unknown>` interface (Kysely+type-plus hybrid) and use it everywhere we currently return `never` on user-facing slots.

### T4 — Conditional Return-Type Degradation (15 libraries — universal)

Definition: a parameter or return type is wrapped in `cond extends X ? Valid : ErrorType<...>`; valid inputs sail through, invalid inputs get an unassignable error type.

Used by every library audited except Zod (which leans on runtime error reporting). Most representative example is tRPC's nested-ternary input parser in `procedureBuilder.ts:201-212` ("Cannot chain an optional parser to a required parser"). ts-pattern's `NonExhaustiveError<remainingCases>` (`Match.ts:10-16`) is the cleanest application of the same pattern in a pure-builder setting.

TS-perf cost: low to medium. Drizzle and Kysely's documented "2.6x more compile-time instantiations" warning (Kysely `select-query-builder.ts:1098` `@deprecated orderByUsingAll`) is a reminder that nesting too many ternaries inside a hot type can hurt; pipesafe should keep the `T1`-wrapping site shallow.

Applicability: 5 across the board. **This is the carrier for T1**; you cannot deploy T1 without T4.

Net recommendation: adopt as part of the same primitive package as T1. Pattern is `<param: cond extends Valid ? param : PipeSafeError<msg, ctx>>`.

### T6 — Constraint-Side Validation (15/16 libraries — universal)

Definition: validate inputs in generic `extends` clauses (`<T extends Constraint>`). Invalid types fail at instantiation with TS's native "X not assignable to Constraint" message.

Universal. Best example for pipesafe is Zod's `discriminatedUnion` constraint (`packages/zod/src/v4/core/api.ts`) which forces each option to declare its discriminator field. Kysely's `RE extends StringReference<DB, TB>` (`src/parser/reference-parser.ts:82-156`) is the direct prototype for what pipesafe needs in `fieldReference.ts`.

TS-perf cost: low. Native constraint checking is the cheapest validation TS offers.

Applicability: 5 for fieldReference.ts and Pipeline.ts (stage-input constraints); 4 for match/set/group.

Net recommendation: keep all current `extends` constraints, but pair them with T1 brands so invalid inputs get a *named* error rather than the generic structural one.

### T10 — Hover-Flattening (10 libraries: ArkType, Drizzle, Effect, gql.tada, HotScript, Kysely, TS-Router, tRPC, type-plus, viem, Zod)

Definition: `type Prettify<T> = { [K in keyof T]: T[K] } & {}` (and variants like `Expand`, `Simplify`, `show`, `obj`). Forces TS to evaluate intersections so hovers display flat objects.

- ArkType: `show<t> = { [k in keyof t]: t[k] } & unknown` (`ark/util/generics.ts:13-14`)
- Effect: `Simplify<A> = { [K in keyof A]: A[K] } & {}` (`packages/effect/src/Schema.ts:59`)
- Kysely: `Simplify<T> = DrainOuterGeneric<{ [K in keyof T]: T[K] } & {}>` (`src/util/type-utils.ts:126`) — note the `DrainOuterGeneric` wrapper for very-deep generics
- TS-Router: `Expand<T>` (`packages/router-core/src/utils.ts:28-34`) — 28 usages, includes a Function bypass
- viem: `Prettify<T>` 215 hits (`src/types/utils.ts:165-167`)

TS-perf cost: low *per-application*, but applying it inside a recursive type can compound. Kysely's `DrainOuterGeneric` is the most defensive variant.

Applicability: 5 for set.ts and group.ts (deep accumulated objects); 4 for Pipeline.ts; 3 for match.ts (already flat-ish); 2 for fieldReference.ts (fields are strings).

Net recommendation: **pipesafe already exports `Prettify` in `packages/core/src/utils/core.ts`**. Audit whether it's being applied at all stage outputs. If not, wrap stage outputs in `Pipeline.ts` and the `_id` shape inferred by `group.ts`. Consider porting Kysely's `DrainOuterGeneric` if compile times degrade.

### T11 — Branded/Phantom Symbols (15 libraries — near-universal)

Definition: attach `unique symbol` keys or branded string-property types to track type-level state with no runtime presence.

Most relevant subvariant for pipesafe is **`UnsetMarker` for state tracking**: tRPC's `UnsetMarker = 'unsetMarker' & { __brand: 'unsetMarker' }` (`utils.ts:1-4`) marks "this slot has not been written yet". Drizzle's `excludedMethods` tuple (`src/sqlite-core/query-builders/delete.ts:17-32`) tracks which methods can no longer be called. ts-pattern's `handledCases` tuple (`src/types/Match.ts:22-150`) accumulates pattern coverage for exhaustiveness.

TS-perf cost: low. Just an extra property in a generic.

Applicability: 4 for Pipeline.ts (track applied stages, forbid re-entry of `$out`/`$merge` etc.); 3 for the others.

Net recommendation: adopt for Pipeline.ts as a **second-phase** improvement to enable stage-ordering errors. Not blocking on the operator/path fixes.

### T2 — Template-Literal Positional Errors (4 libraries: ArkType, Kysely, TS-Router, viem partial)

Definition: error messages embedded in template literals that capture position/context (`"Invalid path '${P}'"`).

- ArkType: `writeUnexpectedCharacterMessage<s>` (`ark/type/parser/shift/operator/operator.ts`)
- Kysely: `KyselyTypeError<\`$narrowType() call failed: passed type does not exist in '${K}'s type union\`>` (`src/util/type-utils.ts:185`)
- TS-Router: `ParsePathParams<T>` recursive parser (`packages/router-core/src/link.ts:49-124`)

TS-perf cost: medium. Template-literal recursion is the most expensive type-system feature pipesafe would adopt.

Applicability: 4 for fieldReference.ts (path `'$user.naem'` → `"Unknown field 'naem' at '$user'"`); 4 for set.ts (dotted-key collisions); 2 for match/group/Pipeline.

Net recommendation: adopt **only inside the `PipeSafeError<msg>` slot**, not as a general DSL parser. Build error messages with `\`Unknown field '${Path}'\`` once a constraint fails, but don't try to parse field strings character-by-character (we'd be reinventing a piece of Kysely without the maintenance bandwidth).

### T5 — Overload Ladders (10 libraries)

Definition: arity-specific overloads with `r extends infer _ ? _ : never` to force evaluation per overload.

- ArkType: `nary.ts:19-25`
- io-ts: `intersection()` with 5 overloads (`src/index.ts:1691-1703`)
- Kysely: `select<>` 3-overload ladder (`src/query-builder/select-query-builder.ts:373-383`)
- ts-pattern: 7 overloads of `.with()` (`src/types/Match.ts:34-130`)
- Valibot: 22 `pipe()` overloads (`packages/valibot/library/src/methods/pipe/pipe.ts:82-2685`)

TS-perf cost: low *if used at finite arities*. Effect notably refused this pattern (per the audit, "no overload ladders").

Applicability: 3 for Pipeline.ts (stage methods are already chain-of-method-calls, not nary); 2 elsewhere.

Net recommendation: **defer**. PipeSafe's API is already builder-style; ladders mainly help nary functions like `intersection(a, b, c, d)`. Revisit if we ever expose a `pipeline(s1, s2, s3)` constructor.

### T7 — Inference Capture (8 libraries)

Definition: extract a type via `infer`, then validate via `Equals<inferred, declared>`.

- ArkType: `equals<inferred, declared> extends true ? unknown : show<declarationMismatch<inferred, declared>>` (`ark/type/declare.ts:122-129`)
- Effect: `Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends ...` (`packages/effect/src/Types.ts:144-147`)
- type-plus: `$Special<T>` dispatches on any/unknown/never branches (`$type/special/$special.ts`)

TS-perf cost: medium. The double-arrow `Equals` trick is a known cost center.

Applicability: 4 for set.ts (compare declared field shape to inferred); 3 for group.ts; 2 elsewhere.

Net recommendation: **adopt selectively** for set.ts dotted-key conflict detection, where we want to know "do these two paths converge to the same property?".

### T8 — String DSL Parser (4 libraries)

Definition: full type-level state machine that tokenizes a string DSL.

- ArkType: full Scanner + StaticState (`ark/type/parser/string.ts`)
- gql.tada: `tokenizeRec` template-literal FSM (`src/tokenizer.ts`)
- Kysely: `ExtractTypeFromStringReference` multi-segment parser (`src/parser/reference-parser.ts:82-156`)
- TS-Router: `ParsePathParams` (`packages/router-core/src/link.ts:49-124`)

TS-perf cost: **high**. This is where TS instantiation depth blows up.

Applicability: 4 for fieldReference.ts only; 1 elsewhere.

Net recommendation: **don't build a generalised parser**. Instead, do a Kysely-style 2-3 segment template-literal split inside a helper for fieldReference paths. Keep depth bounded by the recursion in `FieldPath<T>` (already exists).

### T9 — Phantom-Parameter Error Messages (5 libraries: ArkType, Drizzle, Kysely, tRPC, ts-pattern)

Definition: function parameter is intersected with a conditional error message. ts-pattern's `SeveralAnonymousSelectError<a = 'You can only use a single...'>` (`src/types/FindSelected.ts:159-183`) is the cleanest example.

Applicability: 4 for `set()`/`match()` where the error needs to appear *on the offending key*, not just on the return type.

Net recommendation: pair with T1 — same brand, but injected into the parameter rather than returned.

### T12 — JSDoc Deprecation (10 libraries — widespread)

Definition: `@deprecated` and `@internal` JSDoc on old APIs.

Most aggressive: viem (379 hits), Drizzle (519+ hits), Zod (140+).

Applicability: 3 for pipesafe — useful for the eventual API-cleanup pass. Not error-DX per se.

Net recommendation: low priority; revisit before 1.0.

### T13 — Error Accumulation Strategy (5 libraries)

Definition: collect all errors vs short-circuit.

The audit shows a 50/50 split. Effect (`ParseIssue` tree, `packages/effect/src/ParseResult.ts:29-40`) and Zod (`ZodError.issues`) accumulate. ArkType, ts-pattern, and Typia short-circuit for IDE responsiveness.

Net recommendation: **short-circuit**. Pipesafe's errors are emitted by TS itself; accumulating multiple at the type level is expensive and TS will surface them progressively as the user fixes them anyway.

### T3 — State-Machine Error Finalization (3 libraries: ArkType, gql.tada, ts-pattern, TS-Router)

Definition: a state object threaded through the type that has a `finalizer` slot for an error.

ts-pattern's `Match<i, o, handledCases extends any[] = [], inferredOutput = never>` (`src/types/Match.ts`) is the relevant pattern for pipesafe's `Pipeline<StartingDocs, PreviousStageDocs, Mode>`. Adding a fourth `AppliedStages extends string[]` parameter lets a finalizer like `.toAggregation()` return `IncompletePipelineError<...>` if a required stage is missing.

Net recommendation: medium-priority enhancement to Pipeline.ts.

### Singletons & misses

- **T14 (Generic Context Binding)**: only ArkType invests deeply. Skip for pipesafe.
- **T15 (Declaration Mismatch Objects)**: only ArkType (`declarationMismatch<inferred, declared>` in `ark/type/declare.ts:131-134`). Tempting for set.ts diagnostics; defer.
- **T16 ($Distributive control)**: type-plus only. Pipesafe could borrow the idea for match.ts union narrowing, but it's an experiment.
- **T17 ($ResolveBranch tree)**: type-plus only. Too speculative.

---

## 4. Top recommendations

### R1 — Introduce `PipeSafeError<Msg, Ctx>` and brand the four bad return sites

Cite: Kysely `KyselyTypeError<E>` (`src/util/type-error.ts:1`); Drizzle `DrizzleTypeError<T>` (`src/utils.ts:174-176`); tRPC `TypeError<TMessage>` (`packages/server/src/unstable-core-do-not-import/types.ts:120-121`); type-plus `$Error<M, T>` (`packages/type-plus/src/$type/errors/$error.ts`).

Map: lives in `packages/core/src/utils/core.ts` next to `Prettify`/`Document`. Used by `match.ts`, `fieldReference.ts`, `set.ts`, `group.ts`.

Effort: small (one new exported interface + one mechanical rename of `never` returns at user-facing slots).

Risks: low. Brand symbol collision avoided by using a unique TS symbol per Kysely/tRPC. Watch for `noUncheckedIndexedAccess` interaction since the brand key is optional in some library variants — pipesafe should make it required.

### R2 — Apply `Prettify` to all stage-output types and group `_id` results

Cite: Effect `Simplify<A>` (`packages/effect/src/Schema.ts:59`); Kysely `Simplify<T> = DrainOuterGeneric<...>` (`src/util/type-utils.ts:126`); viem `Prettify<T>` (`src/types/utils.ts:165-167`, 215 usages); TS-Router `Expand<T>` (`packages/router-core/src/utils.ts:28-34`, 28 usages).

Map: `Pipeline.ts` (stage-output constructor returns), `group.ts` (`_id` accumulator), `set.ts` (merged document type).

Effort: small. PipeSafe already exports `Prettify`; this is mostly an audit + apply pass.

Risks: low, but watch compile times. If they regress, port Kysely's `DrainOuterGeneric` wrapper which is specifically designed to combat deep instantiation in long builder chains.

### R3 — Pilot A: typed operator errors in `match.ts` (see §5)

Cite: tRPC's nested-ternary input validation (`packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:201-212`); Kysely's `case().when()` operator-mode toggle (`src/query-builder/case-builder.ts:32-49`).

Map: `packages/core/src/stages/match.ts` `ComparatorMatchers<T>`.

Effort: medium. Touches the core type that drives all match-stage inference; needs careful type-assertion test coverage.

Risks: medium. `MergeUnion<T>` is already in a hot path. Adding extra conditional layers could slow large match queries. Benchmark before committing.

### R4 — Pilot B: typed path errors in `fieldReference.ts` (see §5)

Cite: Kysely's `ExtractTypeFromStringReference` multi-segment template-literal parser (`src/parser/reference-parser.ts:82-156`); TS-Router's `ParsePathParams` (`packages/router-core/src/link.ts:49-124`); Drizzle's `BuildSubquerySelection` (`src/query-builders/select.types.ts:116-131`) which returns `DrizzleTypeError<'You cannot reference this field without assigning it an alias first - use \`.as(<alias>)\`'>` instead of `never`.

Map: `packages/core/src/elements/fieldReference.ts` `InferFieldReference`, `GetFieldTypeWithoutArrays`.

Effort: medium. Recursion in `GetFieldTypeWithoutArrays` already does most of the work; the change is replacing the terminal `: never` with a `: PipeSafeError<\`Unknown field '${Path}' on schema\`, Schema>`.

Risks: medium. Returning a non-`never` type at the leaf widens the result type and may break downstream callers that destructure with `extends never ? ... : ...`. Audit usages via grep for `InferFieldReference` callers before shipping.

### R5 — Add `AppliedStages` accumulator to `Pipeline<...>` for stage-ordering errors

Cite: ts-pattern's `Match<i, o, handledCases extends any[] = []>` exhaustiveness accumulator (`src/types/Match.ts:22-150`); Drizzle's `excludedMethods` (`src/sqlite-core/query-builders/delete.ts:17-32`); tRPC's `UnsetMarker` (`packages/server/src/unstable-core-do-not-import/utils.ts:1-4`).

Map: `packages/core/src/pipeline/Pipeline.ts` add a fourth generic parameter `AppliedStages extends readonly string[] = []`.

Effort: large. This is a breaking change to the `Pipeline` type signature. Recommend behind a `Pipeline.Strict<...>` opt-in first.

Risks: breaking change; potential perf regression from extra tuple manipulation; needs changeset entry. Defer until pilots A and B land and we have data on perf cost.

---

## 5. Pilot API sketches

### Pilot A — `match.ts` typed operator errors

**Before** (`packages/core/src/stages/match.ts:35-52`, simplified):

```ts
export type ComparatorMatchers<T extends unknown> = MergeUnion<
  { $exists?: boolean; $type?: SomeBSONType | SomeBSONType[] }
  & { [m in EqualityMatchers]?: T }
  & { [m in InMatchers]?: T[] }
  & (T extends number ? { [m in ContinuousMatchers]?: number } : {})
  & (T extends Date   ? { [m in ContinuousMatchers]?: Date   } : {})
  & (T extends (infer U)[] ? { $size?: number } | { [m in ArrayOnlyMatcher]?: U[] } | { [m in ElementMatcher]?: U } : {})
  & (T extends string ? { $regex?: unknown } : {})
>;
```

User writes `{ tags: { $gte: 1 } }` against `{ tags: string[] }`. `tags` is `string[]`, so the `T extends number` and `T extends Date` branches both yield `{}`, the intersection drops `$gte`, and TS prints something like:

```
Type '{ $gte: number }' is not assignable to type 'MatchersForType<string[]>'.
  Object literal may only specify known properties, and '$gte' does not exist in type
  'MatchersForType<string[]>'.
```

— useful, but it doesn't say *why* `$gte` was dropped, and on big union schemas the message becomes "is not assignable to never".

**After** — introduce `PipeSafeError`, then wrap each operator-allowed branch and explicitly mark forbidden ones (drawing on tRPC's nested ternaries and Kysely's KyselyTypeError pattern):

```ts
// utils/core.ts
declare const PIPESAFE_ERROR: unique symbol;
export interface PipeSafeError<Msg extends string, Ctx = unknown> {
  readonly [PIPESAFE_ERROR]: { message: Msg; context: Ctx };
}

// stages/match.ts
type NumericOperand<T, Op extends string> =
  T extends number | Date ? T :
  PipeSafeError<`Operator '${Op}' is not allowed on type '${TypeName<T>}' (numeric/date only)`, T>;

type ArrayOperand<T, Op extends string> =
  T extends (infer U)[] ? U[] :
  PipeSafeError<`Operator '${Op}' requires an array field, got '${TypeName<T>}'`, T>;

export type ComparatorMatchers<T> = Prettify<
    { $exists?: boolean; $type?: SomeBSONType | SomeBSONType[] }
  & { [m in EqualityMatchers]?: T }
  & { [m in InMatchers]?: T[] }
  & { [m in ContinuousMatchers]?: NumericOperand<T, m> }
  & { $size?: ArrayOperand<T, '$size'> extends infer A ? (A extends unknown[] ? number : A) : never }
  & { $all?: ArrayOperand<T, '$all'> }
  & (T extends string ? { $regex?: RegExp | string } : { $regex?: PipeSafeError<`'$regex' is only valid on string fields`, T> })
>;
```

Worked example: `{ tags: { $gte: 1 } }` against `{ tags: string[] }`. The new error becomes:

```
Type '{ $gte: number }' is not assignable to type
  '{ $gte?: PipeSafeError<"Operator '$gte' is not allowed on type 'string[]' (numeric/date only)", string[]>; ... }'.
```

The hover reveals the literal message, which is what we want.

### Pilot B — `fieldReference.ts` typed path errors

**Before** (`packages/core/src/elements/fieldReference.ts:33-48`):

```ts
export type GetFieldTypeWithoutArrays<Schema, Path extends string> =
  Schema extends (infer U)[] ? GetFieldTypeWithoutArrays<U, Path>[]
  : Path extends keyof Schema ? Schema[Path]
  : Path extends `${infer Head}.${infer Tail}` ?
      Head extends keyof Schema ? GetFieldTypeWithoutArrays<Schema[Head], Tail>
      : never
  : never;

export type InferFieldReference<S extends Document, Ref extends FieldReference<S>> =
  GetFieldTypeWithoutArrays<S, WithoutDollar<Ref>>;
```

User writes `"$user.naem"` against schema `{ user: { name: string; age: number } }`. Today's hover: `never`. Today's downstream error: "Type 'never' is not assignable to type 'X'", which doesn't say *which* segment was wrong.

**After** — replace each terminal `: never` with a `PipeSafeError` carrying the path segment that failed (Kysely-style). The brand stays out of valid result paths:

```ts
// stages/fieldReference.ts (sketch)
type SegmentMissError<Head extends string, Schema, FullPath extends string> =
  PipeSafeError<
    `Unknown field '${Head}' at path '${FullPath}'. Available: ${Extract<keyof Schema, string>}`,
    { schema: Schema; fullPath: FullPath; failedAt: Head }
  >;

export type GetFieldTypeOrError<Schema, Path extends string, FullPath extends string = Path> =
  Schema extends (infer U)[] ? GetFieldTypeOrError<U, Path, FullPath>[]
  : Path extends keyof Schema ? Schema[Path]
  : Path extends `${infer Head}.${infer Tail}` ?
      Head extends keyof Schema
        ? GetFieldTypeOrError<Schema[Head], Tail, FullPath>
        : SegmentMissError<Head, Schema, FullPath>
  : Path extends string
      ? SegmentMissError<Path, Schema, FullPath>
      : never;

export type InferFieldReference<S extends Document, Ref extends FieldReference<S>> =
  GetFieldTypeOrError<S, WithoutDollar<Ref>>;
```

Worked example: `InferFieldReference<{ user: { name: string } }, "$user.naem">` now resolves to:

```
PipeSafeError<
  "Unknown field 'naem' at path 'user.naem'. Available: name",
  { schema: { name: string }; fullPath: 'user.naem'; failedAt: 'naem' }
>
```

Old vs new: old `never` → no info; new branded error → exact failed segment, available alternatives, and the offending sub-schema. Because the brand is unassignable to anything else, downstream callers (`MatchersForType<InferFieldReference<...>>`) will continue to fail, just with a useful trail.

(Both pilots fit comfortably in <40 lines of new type signatures.)

---

## 6. Risks & open questions

**TS instantiation depth.** Pipesafe runs with `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` (per `CLAUDE.md`). `noUncheckedIndexedAccess` will affect the `Available: ${Extract<keyof Schema, string>}` template-literal in Pilot B — keys come back as `string | undefined` for index signatures, which would produce ugly hover text. Mitigation: `Extract<keyof Schema, string>` already filters; we should add a narrow guard.

**`exactOptionalPropertyTypes`.** When we change `$gte?: number` to `$gte?: NumericOperand<T, '$gte'>`, the optional flag stays — but with `exactOptionalPropertyTypes`, supplying `$gte: undefined` will now mismatch `PipeSafeError<...>`. Should be fine; PipeSafe does not advertise passing `undefined` literally for operators. Add a typeAssertion to lock it down.

**Build-perf.** The Effect audit explicitly flagged its types as heavy (`packages/effect/src` is 187,839 LoC). Effect avoids overload ladders for this reason. PipeSafe's hot path is `Pipeline.match`/`set`/`group` chained 5–10 times; each new `Prettify` and each `PipeSafeError` brand adds a small evaluation cost. Run benchmarks (the project has a `benchmarking/` directory) before and after Pilot A.

**Breaking changes.** Pilot A is non-breaking because `MatchersForType<T>` is a *constraint* on the user's match query — adding error types inside it can only narrow what they could write before, but the runtime contract is unchanged. Pilot B is **possibly breaking** for any internal call that does `InferFieldReference<S, R> extends never ? X : Y`; we need to grep these and update to `extends PipeSafeError<any, any> ? X : Y`.

**Validate with a benchmark before committing**:
1. Run the existing `benchmarking/` suite before Pilot A.
2. After each pilot, re-run and compare instantiation count and `tsc --extendedDiagnostics`.
3. Test against the 21 `*.typeAssertions.ts` files; expect zero regressions.

**Open questions:**
- Should `PipeSafeError` carry `Ctx` always, or only when useful? type-plus carries it always; Kysely doesn't. Pipesafe's debugging story benefits from carrying it.
- Should the error symbol be `unique symbol` (Kysely/tRPC) or a brand string property (Drizzle)? Brand string is friendlier for serialisation/printing in tests; symbol is more collision-proof. Recommend brand string with a `'~pipesafe.error'` key (TypeBox-style tilde prefix to imply internal).

---

## 7. Out of scope / future work

**Worth investigating later:**
- **State-machine `AppliedStages` accumulator** for stage-ordering enforcement (R5 / ts-pattern T3). High value but breaking.
- **Effect-style `Simplify` + `DrainOuterGeneric` combo** if benchmarks regress after Prettify rollout (Kysely `src/util/type-utils.ts:126`).
- **Declaration-mismatch object** (T15, ArkType `declarationMismatch<inferred, declared>`) for set.ts when a user provides an explicit type annotation that disagrees with inference.
- **Distributive control** (T16, type-plus) for match.ts union behaviour. Currently union narrowing in `RawMatchQuery<Schema>` is implicitly distributive; making it controllable would let users opt out of the union-explosion problem in `ComparatorMatchers`.

**Speculative ideas:**
- **TypeScript language-server plugin** that recognises the `PipeSafeError` brand and renders only the `message` field in the hover, hiding the `Ctx`. ArkType has experimented with similar plugins; not blocking, but would polish the DX.
- **Accumulator-based error aggregation** (T13, Effect `ParseIssue` tree) is rejected in §3 but could be revisited if multi-error reporting becomes a user demand.
- **Custom transformer** (Typia-style, `IMetadataTypeTag`) to detect mutually-exclusive operators (e.g., `$eq` + `$gt` on the same field). Heavy lift; only if the type-level approach proves infeasible.

**Investigated and rejected:**
- Full type-level DSL parser (T8, ArkType/gql.tada). Pipesafe's path strings are short (≤4 segments typical) and our `FieldPath<T>` recursion already handles them.
- ZeroWidthSpace sentinel (ArkType `ark/util/errors.ts:41-42`). Adds string-collision protection that branded interfaces achieve more cleanly.
- `r extends infer _ ? _ : never` aggressive instantiation (ArkType `nary.ts:19-25`). Useful for nary builders, but pipesafe is method-chain based.

---

**File written: `/home/user/pipesafe/docs/error-handling-audit/SYNTHESIS.md`**
