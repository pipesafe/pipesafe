# EPIC-D — Hooks & Transactions (TRD)

## Overview

**Goal.** Give PipeSafe the two P1 "daily-driver" surfaces from plan/03 §4–5: (1) a **typed interceptor API** in the Prisma-extensions shape — interception as a typed transformation of a query description, registered at definition time — explicitly _not_ a kareem-style mutable pre/post registry whose effects are invisible to types; (2) **ambient transactions**: `pipesafe.transaction(fn)` backed by `AsyncLocalStorage<ClientSession>`, so nested collection/pipeline calls join the transaction without threading a session.

**Scope.** Interceptor (`query`/`fields`) components on schema-carrying collections; ordering/composition rules; ALS session context + `withTransaction` wrapper; retry policy on top of the driver loop; escape hatches; type-assertion and integration test suites.

**Out of scope.** Document middleware/hydration (no Documents exist — plan/03 non-negotiable #1); Mongoose `_resetSessionDocuments`-style state healing (lean-by-default means there is no per-doc dirty state to heal — plan/03 §5, confirmed unnecessary by spike); manifold `onModelStart/Complete` (orchestration observability, plan/05); the multi-connection registry beyond what session resolution needs.

**Plan docs:** `plan/03-orm-roadmap.md` §4–5, §8 · `plan/01-current-state-and-gaps.md` §3.
**Spikes:** `plan/spikes/als-transactions.spike.ts` (EXECUTED, this TRD) · `plan/spikes/orm-crud-api.spike.ts` (interceptor + typed-CRUD sketch, pre-existing). Background: research briefs on kareem's four middleware families and name-collision warts (mongoose.md) and Prisma `$extends` query components replacing deprecated `$use` (prisma.md).

## Spike findings

`als-transactions.spike.ts` ran against a single-node `MongoMemoryReplSet` (mongod 7.0.24, replset boot ~1.1s):

- **The whole mechanism is ~15 lines.** `als.run(session, () => session.withTransaction(fn))` plus `options.session ?? als.getStore()` at every driver call. Ambient session reached arbitrarily deep async callees, across extra `await` boundaries, and inside `Promise.all` branches — no monkey-patching, no context loss. Commit visible after; throw → abort, rethrow, write rolled back; reads inside the txn see uncommitted writes (read-your-own-write: 75 mid-txn vs committed).
- **Retry works and was forced deterministically.** A blocker session held an open transactional update on doc `x`; our transaction's update hit `code 112, codeName "WriteConflict", errorLabels ["TransientTransactionError"]`; the driver's `withTransaction` re-invoked the callback — **2 attempts, 12ms total, exactly-once effect** (`+10` applied once). Two surprises: WriteConflict **fails fast** (~ms, it does not block on the lock holder), and the driver's retry loop is **time-bounded (~120s), not attempt-bounded, with no backoff** — a persistent conflict means a hot retry loop for two minutes. HOOKS-3 exists because of this.
- **Concurrent ops on ONE session did not throw** (Promise.all of two updates inside one txn committed fine on driver 6.x/mongod 7.0.24) — but sessions are documented as not safe for concurrent use. Since "worked in the spike" ≠ "supported", HOOKS-2 must pick a policy (serialize per-session vs document-as-unsupported) rather than inherit undefined behavior.
- **Concurrent transactions are cleanly isolated**: `Promise.all` of two `withTransaction` blocks saw distinct session ids, no ALS cross-talk; outside any block `als.getStore()` is `undefined`.
- **Explicit override is trivial and correct**: passing an outside session read pre-commit state (81) while the ambient txn saw its own uncommitted write (1081) — the `??` chain is the entire DI story.

No contradictions with plan/03 §5; the doc's claim that retry safety reduces to "the callback re-executes" held, with the added obligation that **the callback must be side-effect-free outside the session** (attempt counters in the spike ran twice — this becomes a documentation requirement in HOOKS-3).

## Tickets

### HOOKS-1: Typed interceptor API (`use({ query, fields })`)

- **Priority** P1 | **Estimate** L | **Depends on** Typed CRUD epic (query descriptions must exist); interlocks with EPIC-C SCHEMA-6
- **Context.** The three production use cases: audit fields, soft delete, tenant filters. Kareem's lessons (avoid): hooks invisible to types, `updateOne` document/query name collisions, RegExp hook matching. Prisma's lesson (adopt): `$use` middleware was deprecated for `$extends` query components — interception as typed transformation.
- **Design.** `collection.use(ext)` on `Collection` (`packages/core/src/collection/Collection.ts`), new `packages/core/src/hooks/` for the types. Two components v1:
  - `query`: one optional interceptor per operation kind (`find`, `findOne`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `insertOne`, `insertMany`, `aggregate`), signature `(args: OpArgs<Op, Schema>, next: (args) => Promise<OpResult>) => Promise<OpResult>` — args are the _typed_ descriptions from the CRUD epic (`MatchQuery<Schema>` filters, typed update docs). Not calling `next` replaces the op (spike-sketched soft delete: `deleteOne` → `updateOne` with `$set: { deletedAt }`).
  - `fields`: write-time computed fields, `{ updatedAt: () => new Date() }` — **type-visible**: `use` returns `Collection<TOut & { updatedAt: Date }>`, the same chained-generic move Pipeline stages use. SCHEMA-6's timestamps are implemented as a built-in `fields` extension.
  - Soft delete as the flagship typed example: a `softDelete()` preset whose `fields` adds `deletedAt?: Date` to `TOut` and whose `find`/`findOne` interceptors inject `{ deletedAt: { $exists: false } }` — the _result type_ gains the field and the _filter type_ accepts it, both inferred, neither assertable.
- **Acceptance criteria.** Interceptor args/results fully typed against the collection schema (typo'd field in an injected filter = existing `PipeSafeError` brand); `fields` changes the inferred output type; op replacement works; phantom-generic collections may also `use` (typed against their generic).
- **Test plan.** `hooks/use.typeAssertions.ts` (arg typing, output-type growth, brand firing inside interceptor-built filters); vitest integration: soft delete end-to-end, tenant filter injected into `find`+`aggregate`, audit fields on update.
- **Open questions.** Does `aggregate` interception receive the built stage array or a prepend-only hook (stage-array mutation would bypass pipeline typing — proposal: prepend-`$match`-only in v1)? Database-level `use` for cross-collection tenancy?

### HOOKS-2: ALS session context + `pipesafe.transaction(fn)`

- **Priority** P1 | **Estimate** M | **Depends on** — (independent of CRUD typing; touches every executor)
- **Context.** No session surface exists today (plan/01 §3). Spike proved the mechanism end-to-end.
- **Design.** New `packages/core/src/session/transactionContext.ts`: module-level `AsyncLocalStorage<ClientSession>` + `resolveSession(explicit?)`. `pipesafe.transaction<T>(fn, opts?)` on the singleton (`packages/core/src/singleton/pipesafe.ts`): start session on the owning client, `als.run(session, () => session.withTransaction(fn, txnOpts))`, `endSession` in `finally` (exact spike shape). Every driver call in `Collection` (all CRUD methods), `Pipeline.execute` (`packages/core/src/pipeline/Pipeline.ts`), and manifold `Project`/`Model` execution resolves `options.session ?? als.getStore()`. Explicit `session` in options always wins (spike-verified). Multi-connection: sessions are client-bound, so `transaction` must start the session from the same client the enclosed collections use — v1 rule: the singleton client; a `client` opt covers the DI case; full multi-connection registry is the follow-up flagged in plan/03 §5. **Promise.all-in-txn policy (decision from spike):** driver tolerated concurrent ops on one session but it is unsupported upstream — v1 documents parallel awaits inside `transaction(fn)` as unsupported and (dev-mode) warns when a second op starts on an in-use ambient session; a per-session op queue is deliberately rejected (silent serialization lies about concurrency).
- **Acceptance criteria.** The spike's scenarios pass as integration tests: nested calls join implicitly; abort rolls back; concurrent transactions isolated; explicit override; `Pipeline.execute` inside a transaction sees the session (`$out`/`$merge` caveats documented — they cannot run in transactions).
- **Test plan.** vitest on `MongoMemoryReplSet` mirroring spike sections 3a–3f; unit test for `resolveSession` precedence; manifold smoke test (model materialization outside, reads inside).
- **Open questions.** Should `transaction` reject nested `transaction` calls (Mongo has no nested transactions) or reuse the ambient session (join semantics)? Proposal: throw in v1.

### HOOKS-3: Transaction retry policy

- **Priority** P1 | **Estimate** S | **Depends on** HOOKS-2
- **Context.** Spike: driver retry is time-bounded (~120s), immediate, and unbounded in attempts — a persistent WriteConflict hot-loops. Mongoose exposes nothing here either; this is cheap differentiation.
- **Design.** `pipesafe.transaction(fn, { maxAttempts = 3, backoff = expJitter(10ms..500ms), onRetry? })`. Implement _around_ the driver loop: run `session.withTransaction` per attempt with our own catch of `TransientTransactionError`-labeled errors (checking `error.hasErrorLabel("TransientTransactionError")`; commit-time `UnknownTransactionCommitResult` stays with the driver's internal handling), sleep with backoff, re-invoke; exhaustion throws `PipeSafeTransactionError` wrapping the last driver error (`code`, `codeName`, `errorLabels` preserved — spike recorded `112/WriteConflict/["TransientTransactionError"]`). `onRetry({ attempt, error })` is the observability hook. Document loudly: the callback re-executes — side effects outside the session must be idempotent (spike's attempt counter ran twice).
- **Acceptance criteria.** Forced-conflict test (spike's blocker-session technique) succeeds within `maxAttempts` and calls `onRetry` once; `maxAttempts: 1` surfaces the WriteConflict; non-transient errors never retry.
- **Test plan.** Deterministic conflict integration test (port spike 3c); unit tests for backoff bounds and label classification with stubbed errors.
- **Open questions.** Default `maxAttempts` 3 vs driver-parity (time-bounded)? Should backoff be pluggable or fixed-with-jitter in v1?

### HOOKS-4: Interceptor ordering & composition rules

- **Priority** P1 | **Estimate** S | **Depends on** HOOKS-1
- **Context.** Prisma's `$use` died on murky ordering; kareem's serial pre/post with error-handler arity is un-typeable. Rules must be pinned before the ecosystem grows.
- **Design.** `use` is chainable; multiple extensions compose as an onion in **registration order**: first registered = outermost (sees user args first, result last); `next` advances inward; built-ins (timestamps via SCHEMA-6, validation via SCHEMA-4) sit innermost, adjacent to the driver, so user interceptors observe the docs that will actually be written. Type-level: each `use` returns a new `Collection` whose `TOut` reflects that extension's `fields` — later extensions see earlier ones' fields in their schema (order is type-visible). Async-only interceptors (no `next()`-callback arity — Mongoose 9 deleted theirs too); errors propagate outward through the onion, no separate error-handler channel.
- **Acceptance criteria.** Documented + tested order for two `query.find` interceptors and interleaved `fields`; a second extension's interceptor can filter on the first extension's added field with full typing.
- **Test plan.** typeAssertions for stacked `use` inference; runtime test asserting call order via probe array; error-propagation test (inner throw reaches caller through outer interceptor's try/catch).
- **Open questions.** Is replacing an op (`deleteOne` → `updateOne`) routed back through the _full_ onion (re-entrancy risk) or dispatched below the current layer? Proposal: below the current layer, matching Prisma's `query` semantics.

### HOOKS-5: Escape hatches

- **Priority** P2 | **Estimate** S | **Depends on** HOOKS-1, HOOKS-2
- **Context.** Same philosophy as `Pipeline.custom()`: strictness with exits, never a cage. Soft-delete users need "find including deleted"; ops scripts need no interceptors at all.
- **Design.** (1) `collection.raw()` → the driver `MongoCollection` (already implied by the CRUD epic; here it must ALSO bypass interceptors — document that it _still_ resolves the ambient ALS session, deliberately: raw ops inside `transaction(fn)` join the txn). (2) Per-call `{ skipInterceptors: true }` (all) or `{ skipInterceptors: ["softDelete"] }` (named extensions — `use(ext, { name })`). (3) `als.exit`-based `pipesafe.withoutTransaction(fn)` for fire-and-forget writes (audit logs that must survive rollback) inside a transaction block.
- **Acceptance criteria.** Each hatch typed (skipping a `fields` extension does not remove its fields from `TOut` — runtime-only skip, documented); `withoutTransaction` write survives an aborted enclosing txn.
- **Test plan.** Integration tests per hatch; typeAssertion pinning that `raw()` returns driver types (permissive by design).
- **Open questions.** Is named skipping worth it in v1 or is all-or-nothing enough?

### HOOKS-6: Regression suites — typeAssertions + replica-set integration harness

- **Priority** P1 | **Estimate** M | **Depends on** HOOKS-1–4
- **Context.** The repo's convention: `*.typeAssertions.ts` are the type tests; `Pipeline.callSite.typeAssertions.ts` pins call-site rejection with `@ts-expect-error`. Hooks/transactions add the first runtime surfaces where behavior (not just types) can regress.
- **Design.** (1) `packages/core/src/hooks/use.callSite.typeAssertions.ts` + `session/transaction.typeAssertions.ts` following the `@ts-expect-error` regression-guard convention (mis-typed interceptor filter, `fields` return-type mismatch, ambient-vs-explicit session option typing). (2) A shared vitest fixture `packages/core/src/testing/replSet.ts` (worker-scoped `MongoMemoryReplSet`, one boot per suite — spike measured ~1.1s boot, fine amortized) used by HOOKS-2/3/5 and EPIC-C integration tests. (3) Port all six spike scenarios as the transaction acceptance suite.
- **Acceptance criteria.** `bun run test:ci` covers commit/abort/retry/isolation/override paths deterministically (no sleeps except the interleave probe); typeAssertions compile under the project tsconfig (`exactOptionalPropertyTypes` etc.).
- **Test plan.** Self-describing (this ticket _is_ the test plan); CI check that the replica-set suite stays under a time budget.
- **Open questions.** Do transaction integration tests live in core only, or does manifold get its own thin suite (Project execution inside a txn)?
