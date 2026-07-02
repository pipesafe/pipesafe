# 03 — ORM Roadmap: From Pipeline Builder to Daily-Driver Data Layer

PipeSafe today is the best typed MongoDB aggregation builder shipping (see `01-current-state-and-gaps.md`), but its CRUD surface is a raw-driver passthrough with zero runtime validation, and it has no hooks, transactions, relations, or migrations story. This document charts the path to the daily-driver MongoDB data layer — the Mongoose/Prisma alternative — by surrounding the typed-pipeline core with the ~20% of ORM surface developers touch every day, while refusing the machinery (hydration, casting, codegen) that makes the incumbents heavy. Priorities: P0 typed CRUD and runtime schema, P1 hooks and transactions, P2 relations and migrations. Spike sketches live in `plan/spikes/`.

## 1. Goal & positioning

Two-line pitch, aimed at each incumbent's documented weak flank:

- **Versus Mongoose**: _PipeSafe is what `Model.aggregate()` should have been._ Mongoose's own docs concede aggregation is untyped and uncast by design (`aggregate<R = any>`); the moment an app needs `$group`/`$lookup`, safety evaporates. PipeSafe starts there and grows outward.
- **Versus Prisma**: _Everything past `findMany`, typed._ Prisma v7 has no MongoDB support at all in its flagship architecture; v6's answer to any real pipeline is `aggregateRaw(pipeline?: InputJsonObject[]): PrismaPromise<JsonObject>`.

Three non-negotiables that define the shape of everything below:

1. **No hydration/casting machinery.** Mongoose spends ~11k lines (`document.js` + `cast*`) building change-tracking Document instances and coercing `"42"` → `42` — complexity that exists to compensate for JavaScript's lack of compile-time guarantees. PipeSafe is lean-by-default: queries return plain objects, exactly what `lean()` gives Mongoose users after they read the performance FAQ. We validate at the boundary (§3), never wrap.
2. **No codegen.** No `prisma generate`, no stale-types footgun, no `node_modules` mutation, no monorepo-workaround package. Types are inferred from a TS schema (or a Standard Schema object) at the call site.
3. **Inference, not declaration.** Union narrowing through `$match`, output types rewritten per stage, relations inferred from `$lookup` — the type system reports what the database will return, not what the user asserted (Mongoose's `populate<Paths>` anti-pattern).

## 2. Typed CRUD (P0)

The most concrete debt in `01-current-state-and-gaps.md`: two divergent typing regimes. `pipeline.sort({ naem: 1 })` is a compile error; `collection.find({ naem: "x" })` compiles fine because `Collection` delegates to the driver's permissive `Filter<Docs>`. This is the highest-leverage, lowest-risk item on the roadmap because every ingredient already exists:

- **Filters**: `MatchQuery<Schema>` (`packages/core/src/stages/match.ts:105`) is exactly a find filter — full operator set, full-depth dotted paths via `FieldSelector`, branded operand errors (`NumericOperand` et al.). Mongoose v9's `WithLevel1NestedPaths` goes one level deep; we go all the way down, with array indices. Reuse it verbatim for `find`, `findOne`, `countDocuments`, `deleteOne/Many`, and the filter half of updates. Bonus: `ResolveMatchOutput`/`FilterUnion` narrow union schemas, so `orders.find({ status: "shipped" })` returns only the shipped variant — a demo neither incumbent can run.
- **Projections**: `project.ts`'s `ValidateProjectQuery` + output resolver already compute the shape of an inclusion/exclusion spec, including mixed-mode rejection. `find` options gain a typed `projection` that narrows the result — Prisma's `GetFindResult` lesson (query-shaped results are _the_ feature users cite), delivered by inference over the literal args instead of a generated `Payload`.
- **Update operators**: new work, but small and formulaic. `$set` reuses `set.ts`'s dotted-key machinery; `$inc/$mul/$min/$max` constrain paths to `FieldSelectorsThatInferTo<Schema, number>` with `PipeSafeError` brands at the operand position (TS2322 per the established convention); `$push/$addToSet/$pull` validate element types against the array's element type; `$unset` reuses `unset.ts` paths.

Sketch (full version in `spikes/orm-crud-api.spike.ts`):

```ts
const users = db.collection<User>("users");

await users.find(
  { "address.city": "Oslo", age: { $gte: 18 } }, // MatchQuery — typo'd path or $gte on string = PipeSafeError
  { projection: { name: 1, "address.city": 1 } } // result: { _id: ObjectId; name: string; address: { city: string } }
);

await users.updateOne(
  { _id: id },
  { $inc: { loginCount: 1 }, $set: { "profile.bio": "hi" } } // $inc on non-number field = branded error
);
```

Signature pattern per stage conventions in `CLAUDE.md`: `<const F extends MatchQuery<Schema>>(filter: F, options?)` so the literal drives both validation and result narrowing. Mongoose v9's safety affordances come near-free: an `orFail` option and `sanitizeFilter`-style runtime `$`-key wrapping on user input. Raw-driver methods stay available via an explicit `collection.raw()` escape hatch — same philosophy as `Pipeline.custom()`. Effort ~3–4 weeks; the risk is compile-perf on the update-operator mapped types (mitigate with `packages/core/benchmarking/`).

## 3. Runtime schema & validation (P0/P1)

The big architectural decision. PipeSafe schemas today are phantom generics — nothing checks that documents actually match, `$jsonSchema` validators are never generated, and there is no place to hang defaults or timestamps. Three options:

- **(a) Standard Schema interop.** Accept any `@standard-schema/spec` v1 schema (Zod, Valibot, ArkType) as the collection definition; infer the TS type from it via `StandardSchemaV1.InferOutput`. One definition drives runtime validation _and_ pipeline typing. Mongoose 9 already ships `'~standard'` support; the ecosystem (tRPC, form libs) speaks it.
- **(b) Own schema builder.** A `p.object({ ... })` DSL. Maximum control (Mongo-native types like `ObjectId`/`Decimal128`, index metadata inline), but it's a fourth schema library users must learn, and we'd be signing up for the validator-maintenance treadmill.
- **(c) `$jsonSchema` generation.** Derive a MongoDB `$jsonSchema` validator from the schema and apply it via `collMod`/`createCollection` — the _server_ rejects malformed writes, including ones from other clients, shells, and old code paths.

**Recommendation: (a) + (c), skip (b).** Standard Schema in; Mongo validators out. No codegen — validator sync happens at runtime through the migration/sync surface (§7). Client-side validation runs on `insert*`/`replaceOne` (cheap, full document); update operators get no client-side validation in v1 (partial-document validation is Mongoose's perennial `runValidators` footgun) — the server-side `$jsonSchema` is the backstop there. A `validationAction: "warn"` passthrough supports gradual adoption on brownfield collections.

```ts
const User = z.object({
  _id: z.custom<ObjectId>(),
  email: z.string().email(),
  age: z.number().int().optional(),
});

const users = db.collection("users", {
  schema: User, // StandardSchemaV1 — TS type inferred, never written twice
  timestamps: true, // adds createdAt/updatedAt to the inferred type (type-visible!)
  validator: { level: "moderate" }, // derive + sync $jsonSchema (see §7)
});
```

Design points that must be decided here, not later:

- **Null vs missing.** Prisma collapses both to `null` (with `isSet` as an escape hatch). PipeSafe's `exactOptionalPropertyTypes` posture already distinguishes `field?: T` from `field: T | null`; the `$jsonSchema` deriver and the Standard Schema bridge must preserve that distinction (optional → key may be absent; nullable → `bsonType` includes `"null"`).
- **Defaults** are applied at insert time by PipeSafe (visible in the inferred insert type as optional-in/required-out), not by the server — Mongo has no default mechanism.
- **Timestamps** are the first built-in hook (§4) and must be _type-visible_: enabling `timestamps: true` changes the inferred document type. Mongoose plugins can't do this; our chained-generic design gets it free.

Effort: bridge + `$jsonSchema` deriver ~4 weeks (the deriver is a well-bounded structural walk over Zod/Valibot internals via their Standard Schema-adjacent metadata, with a documented "unrepresentable ⇒ omitted from validator" rule). The Standard Schema dependency is one tiny spec package.

## 4. Hooks / middleware (P1)

What hooks are actually for in production: audit fields (`updatedAt`, `updatedBy`), soft delete (rewrite deletes to `$set: { deletedAt }`, filter finds), and tenancy (inject `{ orgId }` into every filter). Mongoose proves middleware is the extensibility spine — its plugin ecosystem hangs off kareem — and proves the anti-pattern: hooks are invisible to the type system, `updateOne` needs `{ document: true, query: false }` disambiguation flags, and a plugin that adds fields changes nothing in the types.

PipeSafe adopts the **Prisma-extensions shape instead of the kareem shape**: interception is a typed transformation of a query description, registered at collection/database definition time, not a mutable pre/post registry.

```ts
const collection = db.collection("orders", { schema: Order }).use({
  query: {
    // one interceptor per operation kind; args and result are fully typed
    async find({ filter, options }, next) {
      return next({
        filter: { $and: [filter, { deletedAt: { $exists: false } }] },
        options,
      });
    },
    async deleteOne({ filter }) {
      // soft delete: not calling next() replaces the op
      return this.updateOne(filter, { $set: { deletedAt: new Date() } });
    },
  },
  fields: { updatedAt: () => new Date() }, // write-time computed fields — type-visible in TOutput
});
```

Rules: interceptors compose in registration order, are async-only (no `next()` callbacks — Mongoose v9 deleted theirs too), never overload one name across abstraction levels, and anything that changes the document shape changes the inferred type. `manifold`'s `onModelStart/Complete` callbacks stay separate — those are orchestration observability, not data hooks (see `05-orchestration-and-el-roadmap.md`). Effort ~3 weeks; depends on §2 (interceptors need the typed query descriptions to exist).

## 5. Transactions & sessions (P1)

Today there is no session surface at all (`01-current-state-and-gaps.md` §3). The target is Mongoose's best-in-class ergonomics — `connection.transaction(fn)` wrapping the driver's `withTransaction` retry loop — minus the part we don't need: Mongoose's `_resetSessionDocuments` state-healing exists because hydrated Documents carry dirty-tracking state that must be rolled back on retry. Lean-by-default means we have no such state; retry safety reduces to "the callback re-executes," which is the driver contract.

```ts
await pipesafe.transaction(async () => {
  await accounts.updateOne({ _id: a }, { $inc: { balance: -100 } });
  await accounts.updateOne({ _id: b }, { $inc: { balance: 100 } });
  await pipeline.execute(); // aggregations see the session too
});
```

Implementation: `AsyncLocalStorage<ClientSession>` in the singleton; every `Collection` method and `Pipeline.execute()` resolves `options.session ?? als.getStore()`. Explicit `session` passing remains supported for the DI crowd. This also forces the overdue fix to the singleton's single-global-client constraint (multi-connection registry). Effort ~2 weeks.

## 6. Relations / populate (P2)

PipeSafe's primary answer already exists: **`$lookup` is the join**, server-side, typed against the foreign schema, with `LookupForeignFieldOrError` branding incompatible joins at compile time. Mongoose needs ~15 helper files of client-side machinery (`getModelsMapForPopulate`, `$in` batching with BSON-size-aware splitting, `assignVals` re-stitching) to approximate what `$lookup` does in one stage — and its populate _typing_ is user-asserted (`populate<{ author: Author }>`). We should not rebuild that. What we add:

1. **`findMany` sugar over pipelines**: a `lookup` option on `find` that compiles to `$match` + `$lookup` (+ `$unwind` for `justOne`) under the hood — Prisma's `include` ergonomics, PipeSafe's inference. The read API is literally a typed pipeline in a trench coat.
2. **Optional batched client-side populate for the hot path**: cross-database refs and post-hoc population of already-fetched docs are the two cases `$lookup` can't serve. If demand materializes, steal Mongoose's _mechanics_ (id dedup, batch splitting, parallel-by-default/ordered-in-transactions) but keep inference-based result typing. Explicitly deferred until §2–§5 ship.

No relation-declaration layer in the schema; the `on`/`localField/foreignField` pair at the call site _is_ the relation, checked at compile time. Effort ~3 weeks for (1).

## 7. Migrations (P2)

The competitive gap is real and open: Mongoose has nothing (community `migrate-mongoose`); Prisma has **no `prisma migrate` for MongoDB at all** — `db push` syncs indexes only, and its success message is literally provider-branched to say so. Only prisma-next's EA `Migration<Start, End>` classes point at the future. PipeSafe's answer has two halves:

1. **Declarative sync (state, not steps)**: indexes and `$jsonSchema` validators declared on the collection definition (§3) are diffed against the live database (`listIndexes` + `listCollections` options) and applied — `pipesafe db sync` / `sync({ dryRun })`. This subsumes Mongoose's `syncIndexes()` and Prisma's Mongo `db push` in one command, and it is the runtime consumer of §3's validator deriver.
2. **Data migrations as typed pipelines**: manifold's `$merge` materialization is already 80% of a backfill engine. A migration is `Migration<Start, End>` — start/end TS schemas plus a pipeline whose inferred output must satisfy `End` — executed as a `$merge` back into the collection, with a `_pipesafe_migrations` ledger collection for ordering/idempotency. Typo the backfill and the migration fails to _compile_ against `End`.

```ts
export default defineMigration<UserV1, UserV2>({
  name: "0007_split_name",
  up: (p) =>
    p
      .set({ firstName: { $arrayElemAt: [{ $split: ["$name", " "] }, 0] } })
      .unset("name"),
});
```

Cross-references: the transform-layer stages this needs (`$split` above is currently unimplemented) are scheduled in `04-transform-roadmap.md`; the CLI/runner and ledger design belong to the orchestration surface in `05-orchestration-and-el-roadmap.md`; whether the migration runner lands in Apache core or ELv2 manifold is a packaging decision tracked in `06-architecture-packaging-licensing.md` (recommendation: sync in core, pipeline-backfill runner in manifold — it is manifold's machinery).

## 8. Phasing & risks

| Phase | Item                                                                | Effort (est.) | Depends on                                                |
| ----- | ------------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| P0    | Typed CRUD (filters, projections, update ops, result narrowing)     | 3–4 wk        | match.ts/project.ts reuse                                 |
| P0    | Standard Schema interop + insert validation                         | 2 wk          | —                                                         |
| P1    | `$jsonSchema` derivation                                            | 2 wk          | Standard Schema bridge                                    |
| P1    | Hooks (typed query interceptors, timestamps/soft-delete/tenancy)    | 3 wk          | Typed CRUD                                                |
| P1    | Transactions + ALS sessions (+ multi-connection registry)           | 2 wk          | —                                                         |
| P2    | `find`+`lookup` sugar; (optional) batched populate                  | 3 wk          | Typed CRUD, hooks                                         |
| P2    | `db sync` (indexes + validators) and `Migration<Start, End>` runner | 4 wk          | `$jsonSchema`, manifold, `04-transform-roadmap.md` stages |

**Risks.**

- **The prisma-next race.** Prisma Next already ships a typed Mongo pipeline builder, typed update operators, and typed migrations in EA, in partnership with MongoDB Inc. Its Mongo target has no GA date (Postgres GAs first; plausibly 2027 for Mongo), which is our window: P0/P1 must ship while "the typed Mongo data layer" mindshare is uncontested.
- **Compile-perf is a permanent budget, not a launch gate.** `utils/core.ts` is already 707 lines of recursion-depth engineering; typed update operators and query-shaped narrowing add instantiation load on every CRUD call, which is far higher-frequency than pipeline construction. Every P0 type must land with a benchmark scenario in `packages/core/benchmarking/`, and a `Payload`-style normalized schema IR (Prisma's pre-bucketed trick) is the pressure valve if budgets blow.
- **Scope creep toward Mongoose.** Requests for hydrated documents, casting (`findById("hexstring")`), and getters/setters will come. The answer is the positioning: validation at the boundary, plain objects everywhere else.

**Differentiators to protect** at every design review: literal Mongo syntax (payloads copy-paste to/from `mongosh` — never a callback DSL like prisma-next's `f.status.eq(...)`), union narrowing from arbitrary query predicates (not declared discriminators), inference over declaration/codegen, curated `PipeSafeError` messages as a product surface, and zero engine — PipeSafe emits driver-ready JSON, full stop.
