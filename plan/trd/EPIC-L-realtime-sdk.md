# EPIC-L — Realtime SDK: typed live queries over change streams

**Overview.** Ship "typed live queries for MongoDB": a client subscribes to a typed PipeSafe filter and receives the initial result set plus typed incremental deltas, powered by change streams. This is EPIC-J's machinery pointed at client fan-out instead of data integration, and it attacks Supabase Realtime's documented structural weaknesses ([plan 08](../08-supabase-baas-assessment.md)): WAL-slot polling, per-subscriber RLS re-checks (one insert × 100 subscribers = 100 authorization reads), single-threaded change processing that compute upgrades can't help, best-effort delivery that silently loses events across reconnects, and 500-connection plan caps. Change streams are the better primitive — resumable, server-side filterable with an aggregation pipeline, no slot lifecycle — but the authz half must be built, not borrowed (no RLS in MongoDB; the seam arrives from EPIC-M). **Goal**: subscription protocol, typed client API, a user-hosted server component (and serverless embedding), fan-out, resume, backpressure, and an explicit guarantees statement. **Out of scope**: presence/broadcast channels (not query-shaped), mobile offline sync (the Realm lane), a hosted control plane (plan 05 §4's principle holds: hosts run our process; we never run theirs). Priority P2. Related docs: [plan 08](../08-supabase-baas-assessment.md), [plan 06](../06-architecture-packaging-licensing.md) (license flag, RT-9), EPIC-J TRD (change-stream machinery), EPIC-M RLS policies (in parallel); spikes: [realtime-live-query.spike.ts](../spikes/realtime-live-query.spike.ts) (executed), [change-stream-cdc.spike.ts](../spikes/change-stream-cdc.spike.ts) (foundation).

## Spike findings

[`realtime-live-query.spike.ts`](../spikes/realtime-live-query.spike.ts) was **executed 2026-07-07** against a single-node `MongoMemoryReplSet` (mongodb-memory-server 10.2.x, driver 6.x, mongod 7.0.24). 17/17 checks pass. Key output:

```
[1] live-query cutover: operationTime BEFORE the initial filtered query (EPIC-J recipe)
  PASS: initial query alone is stale (race is real: u1 update landed behind the cursor)
  PASS: live view == fresh query after snapshot + stream cutover (converged at quiescence)
[2] membership: can change events alone detect leave-the-set?
  (a) delivered 1 event(s); view has 3 docs, fresh query has 1
  PASS: naive post-image-only filter SILENTLY DROPS leave-updates and deletes → stale view
  (b) PASS: pre-image $or delivers exactly enter+leave+member-delete and drops non-member noise
      PASS: delete events DO carry fullDocumentBeforeChange once pre-images are enabled
  (c) PASS: passthrough + updateLookup converges WITHOUT pre-images and WITHOUT a separate
      membership map (idempotent remove)
[3] fan-out: 1 shared stream + in-process dispatch vs N=8 server-side-filtered streams
  server cursors: shared shape 1, per-subscriber shape 8
  shape A (shared): 240 events → 8 views in 64ms; ONE resume token for all subscribers
  shape B (per-sub): 240 events across 8 streams in 438ms (incl. 8 idle getMores ≈ 400ms floor)
[4] resume: PASS: view reconverged from the resume token alone — NO initial re-query needed
```

Findings that decide the design:

1. **The membership question is answered: pre-images are an optimization, not a correctness requirement.** A doc's UPDATE can move it into or out of the filtered set. (a) A server-side `$match` on the post-image predicate alone is silently wrong: leave-the-set updates no longer match, and delete events carry no `fullDocument` at all — both were dropped, the view kept two stale docs. (b) With `collMod { changeStreamPreAndPostImages: { enabled: true } }` and `fullDocumentBeforeChange: "whenAvailable"`, `$or`-ing the predicate over `fullDocument` **and** `fullDocumentBeforeChange` delivered exactly enter/leave/member-delete (deletes do carry the before-image) and dropped non-member noise — exact server-side filtering, but only where pre-images are enabled. (c) Without pre-images, the **passthrough shape** (inserts/replaces filtered; updates/deletes always delivered) plus `updateLookup` post-images converges with no separate membership map: the view _is_ the membership map, since removing a non-matching or deleted `_id` is idempotent — at the cost of non-member noise (4 events vs 3). ⇒ RT-4: passthrough default, pre-image shape per-collection opt-in, naive shape unrepresentable.
2. **EPIC-J's snapshot-to-stream handoff carries over verbatim** (cf. change-stream-cdc.spike.ts scenario 1 / EPIC-J finding 1): capture `operationTime` **before** the initial filtered query, seed the view from the cursor, stream from `startAtOperationTime` — a racing update behind the query cursor, a mid-query membership enter, an insert, and a member delete all healed by replay. Replay is inclusive/at-least-once, so view application must stay idempotent.
3. **Surprise: driver change streams are lazy.** No server cursor exists until the first `next()`/`tryNext()` — a stream "opened" before writes but first read after them starts at "now" and silently misses them (a first spike run delivered 0 of 240 fan-out events). Every subscription must be anchored explicitly (`startAtOperationTime`/`resumeAfter`) or primed before the subscription is acked (RT-1/RT-3).
4. **Fan-out: shared stream wins structurally and measurably.** One shared stream dispatching to 8 in-process predicates drained 240 events in 64ms vs 438ms for 8 server-side-filtered streams; server cursor cost 1 vs 8 (`serverStatus`), i.e., N independent oplog scans — the same amplification pathology as Supabase's per-subscriber re-checks. Resume tokens: the shared shape has **one** token; per-subscriber positions must derive from it (RT-5). Localhost absolutes flatter shape B; the structural argument stands regardless.
5. **Resume without re-query works.** Saving the last applied event's token, closing, mutating offline (insert/enter/leave/member-update), then `watch(resumeAfter)` with the same pipeline reconverged the retained view — no re-query. Re-query remains the fallback for EPIC-J's failure taxonomy (label `NonResumableChangeStreamError`, codes {286, 280, 50811}, silent future-token hang → liveness watchdog). Caveat: `updateLookup` post-images are current-state, so replayed intermediate states can be ahead of event time — convergence at quiescence holds; per-event historical fidelity needs post-images enabled (RT-8).

## Tickets

### RT-1: subscription protocol + typed client API

- **Priority** P2 | **Estimate** L | **Depends on** EPIC-J change-stream machinery (CONN-3's anchor/resume recipe); core `MatchQuery` types
- **Context**: the product surface — `const q = liveQuery(users).match({ plan: "pro" })` with end-to-end types, unlike Supabase's untyped `postgres_changes` payloads.
- **Design**: in a new `@pipesafe/realtime` (see RT-9): `subscribe(source, query, opts) → AsyncIterable<LiveQueryEvent<T>>` plus a callback adapter. The delta union (the wire contract, versioned like EPIC-G's events):

  ```ts
  type LiveQueryEvent<T> =
    | { type: "snapshot"; docs: T[]; token: ResumeToken } // initial result set
    | { type: "upsert"; doc: T; token: ResumeToken } // enter or member-update (spike: one case client-side)
    | { type: "remove"; id: IdOf<T>; token: ResumeToken } // leave-the-set OR delete
    | { type: "resync"; reason: "history-lost" | "watchdog" | "slow-consumer" }; // full re-snapshot follows
  ```

  Filters are typed `MatchQuery<T>` subsets restricted to what compiles into both a `find` filter and a change-event `$match` (no `$where`/`$expr` v1); a `PipeSafeError` brands unsupported operators. Server protocol: WebSocket, JSON frames `{ subId, event }`; subscribe ack only after the stream is anchored (finding 3).

- **Acceptance criteria**: type assertions prove `LiveQueryEvent<T>` narrows per `type`; snapshot precedes any delta; unsupported operators fail compile with a brand.
- **Test plan**: `realtime.typeAssertions.ts`; memory-server integration porting spike scenarios 1–2 to the public API; convergence property test (random ops, view == fresh query at quiescence).
- **Open questions**: pipeline-shaped subscriptions (`$project` on deltas) — v1.1; deltas-as-patches vs full docs — start full docs.

### RT-2: server component vs serverless embedding

- **Priority** P2 | **Estimate** M | **Depends on** RT-1; EPIC-I CLI/host seam (config loading, singleton hazard)
- **Context**: fan-out needs a long-lived process, but plan 05 §4's do-NOT-build-a-control-plane principle governs: we ship a library and a bin, never a hosted service.
- **Design**: `createRealtimeServer({ project | collections, auth })` returning `{ attach(httpServer), listen(port) }` — embeddable in the user's Express/Bun/Fastify process, plus a thin `pipesafe-realtime serve` bin reusing EPIC-I CLI-2 config discovery and CLI-6 secret handling. Serverless: documented as **unsupported for subscriptions** (a WebSocket fan-out host must be long-lived; change streams can't resume per-invocation economically) — the serverless story is one-shot `fetchAndToken()` (snapshot + token) with a long-lived edge/relay holding the streams.
- **Acceptance criteria**: same subscription behavior embedded vs bin; process restart resumes all subscriptions from persisted tokens (RT-5); no daemon/scheduler machinery.
- **Test plan**: integration test embedding into a bare `http.Server`; kill/restart soak test.
- **Open questions**: multi-node horizontal scale (subscribers sharded by collection across processes) — document the pattern, build nothing in v1.

### RT-3: shared-stream fan-out architecture

- **Priority** P2 | **Estimate** L | **Depends on** RT-1, RT-2; spike finding 4
- **Context**: this is where Supabase breaks (single-threaded WAL fan-out, per-subscriber DB re-checks); the design goal is one stream per watched collection, all per-subscriber work in-process.
- **Design**: a `StreamMux` per (db, collection): one anchored change stream (passthrough or pre-image shape per RT-4), dispatching each event to N subscriber predicates in-process (compiled filter functions, not per-event queries). Subscribers attach with either a token (resume) or "now + snapshot". Per-subscriber outbound queues (RT-6). The mux's single resume token is checkpointed; per-subscriber positions are (mux token, applied flag) — finding 4. Escape hatch: `dedicatedStream: true` for pre-image collections with highly selective filters.
- **Acceptance criteria**: N subscribers on one collection = exactly 1 server cursor (assert via `serverStatus` as the spike did); per-event dispatch is O(subscribers) predicate calls with zero DB reads (the anti-Supabase property, asserted by profiling counters).
- **Test plan**: port spike scenario 3 as a regression benchmark; correctness test that mux dispatch equals per-subscriber dedicated streams on identical workloads.
- **Open questions**: predicate indexing for large N (group subscribers by equality keys) — defer until a benchmark demands it.

### RT-4: membership tracking (from spike finding 1)

- **Priority** P2 | **Estimate** M | **Depends on** RT-3
- **Context**: the correctness crux — updates move docs across the filter boundary; naive server filtering silently diverges.
- **Design**: encode the spike verdict. Default: **passthrough** stream shape + `updateLookup`; the server-side view map per subscription doubles as the membership record; `pred(postImage)` false or delete ⇒ emit `remove` only if the id was a member (suppress noise before it reaches the wire). Opt-in per collection: `preImages: true` verifies `changeStreamPreAndPostImages` via `collMod`/`listCollections` and switches the mux to the `$or(fullDocument, fullDocumentBeforeChange)` shape — exact server-side filtering. The naive shape has no API spelling.
- **Acceptance criteria**: spike scenario 2(a)–(c) as CI tests against the public API; noise updates never produce wire frames in either shape; pre-image mode fails loudly at subscribe time if pre-images are not enabled.
- **Test plan**: matrix (shape × enter/leave/member-delete/noise); memory boundedness of the membership map under churn.
- **Open questions**: membership map memory for huge result sets — cap + spill to "id-set only" mode (deltas without doc bodies)?

### RT-5: resume semantics

- **Priority** P2 | **Estimate** M | **Depends on** RT-3; EPIC-J CONN-3 (failure taxonomy, watchdog), EPIC-G event log conventions (`_manifold`-style store)
- **Context**: Supabase documents silent event loss across reconnects; our answer must be a token, not a shrug.
- **Design**: every `upsert`/`remove` frame carries the mux token (RT-1); clients reconnect with `{ subId, token }`; server resumes via `resumeAfter` (spike finding 5 — no re-query on the happy path). On EPIC-J's non-resumable set (label or code ∈ {286, 280, 50811}) or watchdog fire (no event **and** no `postBatchResumeToken` progress within a bound), emit `resync` and replay snapshot — the client swaps state wholesale. Server persists mux tokens periodically (dual cadence per EPIC-J) to survive restarts.
- **Acceptance criteria**: spike scenario 4 as a CI test through the wire protocol; fabricated-token and watchdog paths end in a converged view via `resync`, never a stale one.
- **Test plan**: kill/restart tests; mutated/future-token injection (reuse EPIC-J spike's fabrication technique); offline-window membership changes replay correctly.
- **Open questions**: how long clients may stay offline before tokens age out of the oplog — surface as a documented `resync` likelihood, not a config promise.

### RT-6: backpressure & slow-consumer policy

- **Priority** P2 | **Estimate** M | **Depends on** RT-3, RT-5
- **Context**: one slow WebSocket must not stall the mux (Supabase's single-threaded ordering bottleneck) — and "drop silently" is the failure mode we're positioning against.
- **Design**: per-subscriber bounded queue (default 1,000 frames / bytes cap). On overflow: **degrade to resync** — drop the queue, mark the subscriber, send `resync(slow-consumer)` with a fresh snapshot when it drains. Never block the mux; never silently skip a delta. Metrics per subscriber (depth, drops, resyncs) exposed via a stats hook (EPIC-G-style events optional).
- **Acceptance criteria**: a stalled consumer cannot delay a healthy one (two-subscriber test with an artificial stall); overflow always ends in a converged view; heap bounded under firehose (EPIC-J CONN-8's methodology).
- **Test plan**: soak test with randomized stalls; heap regression assertion; ordering preserved for healthy subscribers throughout.
- **Open questions**: coalescing repeated upserts for the same `_id` in-queue (safe — last-write-wins per key) — lean yes, it's the cheap 80% of backpressure.

### RT-7: authz hook seam (composition point for EPIC-M)

- **Priority** P2 | **Estimate** S | **Depends on** RT-1/RT-3 interfaces; EPIC-M RLS policies (RLS-4 delivers the predicate compiler; this ticket ships the composition point, not the policies); EPIC-D interceptors (same hook philosophy)
- **Context**: MongoDB has no RLS; plan 08's read is that subscription authz must compile into predicates. Supabase re-checks policies per event per subscriber in the database; we evaluate once at subscribe time and push the result into the filter.
- **Design**: `authorize(ctx) → MatchQuery<T> | Deny` hook on the server config: at subscribe, EPIC-M's compiled policy fragment (RLS-4) is **intersected** (`$and`) with the client's filter before the predicate/stream shape is compiled — thereafter zero per-event authz work; the membership machinery (RT-4) automatically handles docs that leave the _authorized_ set too. This answers RLS-4's open question: EPIC-L uses `updateLookup` universally (passthrough shape), so permitted partial updates are never silently dropped. Claim-revalidation: an optional TTL re-runs `authorize` and diffs the predicate (changed ⇒ `resync`). The hook contract is frozen here so EPIC-M composes without touching mux internals.
- **Acceptance criteria**: a subscriber never receives a doc outside `authorize`'s fragment, including via updates that move docs across the authz boundary; per-event dispatch does no authz evaluation (profiled).
- **Test plan**: two-tenant fixture with overlapping filters; boundary-crossing update tests; TTL revalidation test.
- **Open questions**: field-level redaction (project-out per policy) — EPIC-M's call; the seam passes an optional projection through.

### RT-8: delivery & ordering guarantees statement

- **Priority** P2 | **Estimate** S | **Depends on** RT-1..6 (documents what they build)
- **Context**: Supabase's docs say "the server does not guarantee that every message will be delivered" — being explicit and stronger is a marketing asset only if it's written down and tested.
- **Design**: a published guarantees doc, each claim CI-pinned: per-`_id` ordering within a subscription; at-least-once deltas with idempotent client application (tokens make duplicates detectable); convergence at quiescence (view ≡ fresh query — the spike's invariant, stated as THE contract); no silent loss — every gap surfaces as `resync`; intermediate-state caveat for `updateLookup` (current-state post-images; exact per-event history only with post-images enabled); explicit non-guarantees (cross-collection ordering, exactly-once).
- **Acceptance criteria**: every claim maps to a named CI test; the doc ships with the package README.
- **Test plan**: property-test suite tagged `guarantees:*`; doc-to-test linkage checked in CI.
- **Open questions**: none — this is a forcing function, not a feature.

### RT-9: packaging & license

- **Priority** P2 | **Estimate** S | **Depends on** RT-1/RT-2 shapes; plan 06 open decision (maintainer sign-off required)
- **Context**: plan 06's tolerance line — "the thing I run every day must be OSS" — and its open CLI-license question apply squarely here; the realtime server is a daily-run artifact but also exactly what a hosted competitor would resell.
- **Design**: two packages: `@pipesafe/realtime-client` (browser/node client, delta types, view maintenance) — **Apache**, unambiguously; `@pipesafe/realtime` (mux, server, authz seam) — **flagged for the same decision as the CLI** (Apache shell vs ELv2; ELv2's no-managed-service clause is arguably the right fence for the server piece). Depends on `@pipesafe/core` types only; manifold optional (models as sources).
- **Acceptance criteria**: license decision recorded in plan 06 before first publish; client package has zero ELv2 imports (lint-enforced).
- **Test plan**: dependency-cruiser rule in CI.
- **Open questions**: the license call itself — explicitly a maintainer decision, mirroring plan 06 §5.

### RT-10: integration test suite

- **Priority** P2 | **Estimate** M | **Depends on** RT-1..7
- **Design/Context**: the epic's spine test: N subscribers with mixed filters and authz fragments over a collection under randomized concurrent churn (inserts/updates/replaces/deletes, membership crossings, kills/reconnects, slow consumers) on `MongoMemoryReplSet`; at quiescence every client view must equal its fresh authorized query (the spike's `viewEqualsQuery`, generalized). Plus real-mongod follow-up for oplog-rollover `resync` (not forceable on memory server — EPIC-J finding 3).
- **Acceptance criteria**: soak passes 100 randomized seeds in CI; failure artifacts dump the op log + divergent view for replay.
- **Test plan**: seeded PRNG scenarios; CI shard for the soak; capped-oplog test on real mongod tagged manual.
- **Open questions**: browser-client e2e (playwright + WebSocket) — v1.1.
