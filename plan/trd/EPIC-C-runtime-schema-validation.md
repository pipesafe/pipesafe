# EPIC-C — Runtime Schema & Validation (TRD)

## Overview

**Goal.** Replace PipeSafe's phantom-generic collection schemas with a real runtime schema layer: any Standard Schema v1 object (Zod, Valibot, ArkType) defines a collection once, drives TS inference everywhere, validates inserts client-side, and is compiled to a MongoDB `$jsonSchema` validator that the server enforces against every writer — including mongosh and legacy code paths.

**Scope.** Standard Schema ingestion and type inference; the `defineCollection`/`db.collection(name, { schema })` surface and registry; `$jsonSchema` derivation; client-side insert/replace validation; validator sync via `collMod` (the runtime half of `db sync`, plan/03 §7); defaults and type-visible timestamps; validation-error DX.

**Out of scope.** Update-operator client validation (explicit v1 non-goal per plan/03 §3 — the server validator is the backstop); index sync and the `Migration<Start, End>` runner (plan/03 §7, separate epic); hooks machinery itself (EPIC-D — timestamps here only _consumes_ it); hydration/casting of reads (non-negotiable #1 in plan/03 §1).

**Plan docs:** `plan/03-orm-roadmap.md` §3, §7, §8 · `plan/01-current-state-and-gaps.md` · `plan/06-architecture-packaging-licensing.md` (this layer is Apache-2.0 core).
**Spikes:** `plan/spikes/standard-schema-jsonschema.spike.ts` (EXECUTED, this TRD) · `plan/spikes/orm-schema-api.spike.ts` (illustrative API sketch, pre-existing).

## Spike findings

`standard-schema-jsonschema.spike.ts` ran against a real mongod 7.0.24 (mongodb-memory-server). It inlines the StandardSchemaV1 interface, implements a tiny descriptor-carrying schema builder that satisfies it, derives a `$jsonSchema` from the descriptor, and exercises the server. Key results:

- **Rejection shape.** Invalid insert → `MongoServerError` with `code: 121`, `errmsg: "Document failed validation"`, and a structured `errInfo`:

  ```json
  {
    "failingDocumentId": "6a476523...",
    "details": {
      "operatorName": "$jsonSchema",
      "schemaRulesNotSatisfied": [
        {
          "operatorName": "properties",
          "propertiesNotSatisfied": [
            {
              "propertyName": "email",
              "details": [
                {
                  "operatorName": "bsonType",
                  "specifiedAs": { "bsonType": ["string"] },
                  "reason": "type did not match",
                  "consideredValue": 42,
                  "consideredType": "int"
                }
              ]
            }
          ]
        },
        {
          "operatorName": "required",
          "specifiedAs": { "required": ["_id", "email", "deactivatedAt"] },
          "missingProperties": ["deactivatedAt"]
        }
      ]
    }
  }
  ```

  **Surprise:** `err.codeName` is `undefined` on insert write errors — the driver surfaces the raw WriteError, which carries only `code`/`errmsg`/`errInfo`. DX code (SCHEMA-7) must map `121 → DocumentValidationFailure` itself. The tree is rich enough to reconstruct per-path messages (`propertyName`, `reason`, `consideredValue`, `consideredType`).

- **Null vs missing works exactly as plan/03 §3 demands.** Optional key omitted from `required` → absent passes, _explicit null fails_; nullable → `bsonType: [..., "null"]` → null passes, absence fails (when required). The server natively preserves the `exactOptionalPropertyTypes` distinction; the deriver just has to encode it.
- **`collMod` swaps validators live** (`ok: 1`), and the new validator applies to the next write immediately. Existing non-conforming documents are untouched — validators check writes, never data at rest. `listCollections({ name })` round-trips both the validator body and `validationLevel`/`validationAction`, which is what the sync differ needs.
- **Knobs verified.** `validationAction: "warn"`: the invalid insert _succeeds_ with no client-visible signal at all (violation goes to the server log only) — any plan to surface warn-mode violations in-process is a dead end; warn is audit-via-server-logs, full stop. `validationLevel: "moderate"`: an update leaving a _pre-existing invalid_ doc invalid is allowed, while the same update against a conforming doc is rejected (121); `strict` rejects both. Moderate is the brownfield adoption knob and must be reachable from the API.
- **BSON numeric nuance.** `bsonType: "int"` rejected `42.5` (`consideredType: "double"`) but accepted `42` — the driver encodes small integral JS numbers as int32. So plain TS `number` fields must derive to `["int","long","double","decimal"]` (or the `"number"` alias); emitting bare `"int"` is only sound for vendor-level `.int()` constraints.
- **The structural decision (forced):** the `~standard` property exposes _only_ `validate()` — **Standard Schema has no introspection API**, confirmed by implementing it. The spike derives `$jsonSchema` from its own descriptor, not from `~standard`. Consequence: **generic `deriveJsonSchema(schema: StandardSchemaV1)` (as sketched in `orm-schema-api.spike.ts` §3) is unimplementable as typed.** This _sharpens_ plan/03 §3's line that the deriver is "a well-bounded structural walk over Zod/Valibot internals via their Standard Schema-adjacent metadata": there is no standard-adjacent metadata; the walk must be **per-vendor adapters** dispatched on `~standard.vendor` (Zod v4 ships `z.toJSONSchema`, Valibot has `@valibot/to-json-schema`; both need post-processing into Mongo's draft-4 dialect: `bsonType` mapping, Date/ObjectId which JSON Schema cannot express, stripping `$ref`/`format`/`$schema` which `$jsonSchema` forbids). Design consequence baked into SCHEMA-3: validation (SCHEMA-1/4) works for _any_ vendor; **validator derivation works only for adapted vendors**, with a typed, documented fallback (explicit `bsonSchema` override or no server validator).

No contradictions with plan/03 beyond that sharpening; every posture the doc pinned (null-vs-missing, moderate/warn passthrough, lossy-but-sound omission rule) survived contact with the server.

## Tickets

### SCHEMA-1: Standard Schema ingestion and type inference

- **Priority** P0 | **Estimate** S | **Depends on** —
- **Context.** Everything downstream needs a canonical way to accept a `~standard` schema and infer its output type. Zero new runtime dependencies: the spec is an interface, inlined (per spike, ~30 lines).
- **Design.** New `packages/core/src/schema/standardSchema.ts`: inlined `StandardSchemaV1`, `InferOutput<S>`, `validateSync(schema, value)` helper (throws `PipeSafeError`-adjacent runtime error if `validate` returns a Promise and the call site is sync — Standard Schema permits async validators; insert paths (SCHEMA-4) await, so async is supported there). Export from `@pipesafe/core` public surface.
- **Acceptance criteria.** A hand-rolled spec-conformant object, real Zod v4, and real Valibot schemas (dev-dep only, in tests) all type-infer through `InferOutput` and validate; optional (`age?: number`) and nullable (`deactivatedAt: Date | null`) survive inference under `exactOptionalPropertyTypes`.
- **Test plan.** `schema/standardSchema.typeAssertions.ts` (inference incl. optional/nullable), vitest unit tests for validate pass/fail/issue paths and the async case.
- **Open questions.** Do we re-export `InferOutput` as `pipesafe.infer` (Zod-style DX)?

### SCHEMA-2: `defineCollection` — schema-carrying collections and registry

- **Priority** P0 | **Estimate** M | **Depends on** SCHEMA-1
- **Context.** `Database.collection<Schema>(name)` (`packages/core/src/database/Database.ts`) takes a phantom generic. The new form takes a runtime schema and becomes the anchor for validation, derivation, sync, defaults, timestamps, and EPIC-D interceptors.
- **Design.** Overload on `Database.collection` (and singleton passthrough in `packages/core/src/singleton/pipesafe.ts`): `collection<S extends StandardSchemaV1, const Opts>(name, opts: { schema: S; timestamps?: boolean; validator?: { level: "strict" | "moderate" | "warn" }; defaults?: ... })` returning `Collection<WithTimestamps<InferOutput<S>, Opts>>` per the `orm-schema-api.spike.ts` sketch. `Collection` (`packages/core/src/collection/Collection.ts`) gains an internal `schemaConfig` slot. A per-`Database` registry (`Map<string, SchemaConfig>`) records definitions so `db.sync()` (SCHEMA-5) can enumerate them; defining the same name twice with different schemas throws at definition time.
- **Acceptance criteria.** Inferred doc type flows into `Pipeline` generics and manifold `Model` sources unchanged; phantom-generic form keeps working untouched; registry enumerable.
- **Test plan.** typeAssertions for the overload (incl. `timestamps: true` changing the type — SCHEMA-6); unit tests for registry duplicate detection; an example under `packages/core/examples/`.
- **Open questions.** Is `validator.level: "moderate"` mapped to `validationLevel: moderate` + `validationAction: error`, and `"warn"` to `strict` + `warn` (spike shows the two knobs are orthogonal — the option name must not conflate them; proposal: accept `{ level?, action? }` verbatim instead of one enum).

### SCHEMA-3: `$jsonSchema` derivation via vendor adapters

- **Priority** P1 | **Estimate** L | **Depends on** SCHEMA-1
- **Context.** The decision the spike forced (see findings): no generic derivation exists. We ship adapters keyed on `~standard.vendor`.
- **Design.** `packages/core/src/schema/deriveJsonSchema.ts` with `deriveJsonSchema(schema, adapters): { $jsonSchema: Document; omissions: { path: string; reason: string }[] }`. Internal IR: the spike's `Descriptor` shape (kind/optional/nullable/fields), extended with arrays, enums/literals, unions. Adapters (`schema/adapters/zod.ts`, `adapters/valibot.ts`) produce the IR — for Zod v4 via `z.toJSONSchema` output post-processed (JSON-Schema `type` → `bsonType`; `z.date()`/`ObjectId` custom types via adapter-level overrides since JSON Schema can't express them); IR → `$jsonSchema` is one shared walk implementing the pinned rules: optional ⇒ omit from `required`; nullable ⇒ append `"null"` to `bsonType`; plain number ⇒ `["int","long","double","decimal"]` (spike nuance); unrepresentable constructs (refinements, transforms) ⇒ recorded in `omissions`, never guessed — **lossy-but-sound**: the server validator accepts a superset of client-valid docs. Unknown vendor + `validator` requested ⇒ typed error suggesting the `bsonSchema` escape hatch (raw validator object accepted verbatim).
- **Acceptance criteria.** Derived validators for a fixture matrix (all scalar kinds, nested object, optional/nullable crosses, arrays) match golden files AND are accepted by a real mongod; every rejection the spike demonstrated reproduces through the derived validator; `omissions` populated for a refinement.
- **Test plan.** Golden-file unit tests; mongodb-memory-server integration test reusing the spike's null-vs-missing matrix; property test: any doc passing client `validate()` must pass the derived server validator (soundness direction).
- **Open questions.** ArkType adapter in v1 or on demand? Do adapters live in core or per-vendor entry points (`@pipesafe/core/zod`) to keep vendor types out of the main d.ts?

### SCHEMA-4: Client-side validation on insert/replace

- **Priority** P0 | **Estimate** S | **Depends on** SCHEMA-1, SCHEMA-2
- **Context.** Plan/03 §3: validate full documents on `insertOne`/`insertMany`/`replaceOne` (cheap, complete); update operators get **no** client validation in v1 (Mongoose's `runValidators` footgun); reads are never validated.
- **Design.** In `Collection.insertOne/insertMany/replaceOne`: when `schemaConfig` present, `await schema['~standard'].validate(doc)` _after_ defaults/timestamps injection (SCHEMA-6, so the validated doc is the stored doc) and before the driver call. Failure throws `PipeSafeValidationError extends Error` with `issues: ReadonlyArray<StandardIssue>` verbatim and `collectionName`. `insertMany` validates all docs first and reports every failing index (`{ index, issues }[]`) before sending anything (default `ordered` semantics preserved). Per-call opt-out: `{ validate: false }`.
- **Acceptance criteria.** Bad insert never reaches the server; issues carry paths; `validate: false` bypasses; phantom-generic collections are unaffected.
- **Test plan.** Unit tests with a spec-conformant stub schema (sync + async validate); integration test proving a doc rejected client-side would also have been rejected server-side (coherence with SCHEMA-3).
- **Open questions.** Should `replaceOne` validation strip/allow `_id` mismatch with filter? (Driver forbids `_id` change; we should pre-validate against the schema including `_id`.)

### SCHEMA-5: Validator sync — diff + `collMod`

- **Priority** P1 | **Estimate** M | **Depends on** SCHEMA-2, SCHEMA-3
- **Context.** The runtime consumer of the deriver and half of plan/03 §7's `db sync` (index sync is a sibling ticket in the migrations epic; keep the diff engine shared-shaped).
- **Design.** `collection.sync({ dryRun? })` and `db.sync()` (iterates SCHEMA-2's registry). Read current state via `listCollections({ name })` (spike-verified round-trip of `validator`, `validationLevel`, `validationAction`); deep-compare against derived target; apply via `createCollection` (missing) or `db.command({ collMod, validator, validationLevel, validationAction })`. Result: `{ validator: "created" | "updated" | "unchanged"; level/action changes; omissions }` — `dryRun` returns the same report without writing. Never auto-tighten silently: moving action `warn → error` or level `moderate → strict` requires the option to be explicit in the collection definition (it is), but sync's report must call it out since pre-existing invalid docs will start failing updates (spike: strict rejects updates to pre-existing invalid docs).
- **Acceptance criteria.** Fresh collection created with validator; drifted validator updated; no-op detected as `unchanged` (idempotent — byte-stable derivation ordering required); dryRun writes nothing.
- **Test plan.** Integration tests on mongodb-memory-server covering create/update/no-op/level-change; unit test for the differ against listCollections fixtures.
- **Open questions.** Normalization for comparison (server may reorder keys)? Concurrency guard when two processes sync simultaneously (likely: last-writer-wins documented, ledger comes with migrations epic).

### SCHEMA-6: Defaults and type-visible timestamps

- **Priority** P1 | **Estimate** M | **Depends on** SCHEMA-2, SCHEMA-4; interlocks with EPIC-D HOOKS-1
- **Context.** Mongo has no server defaults; PipeSafe applies them at insert. `timestamps: true` is the first built-in hook and must change the inferred type (plan/03 §3) — the differentiator Mongoose plugins can't deliver.
- **Design.** `defaults: { [path]: value | () => value }` on the collection definition; insert type becomes optional-in/required-out for defaulted keys (`WithDefaults<T, D>` mapped type). `timestamps: true` ⇒ inferred type gains `createdAt: Date; updatedAt: Date` (`WithTimestamps` per the sketch) and registers a built-in write interceptor (EPIC-D HOOKS-1 field component) setting `createdAt` on insert, `updatedAt` on insert/update (`$set` injection on update ops — allowed because it's _our_ generated write, not user partial-doc validation). Ordering: defaults → timestamps → client validation (SCHEMA-4) → driver.
- **Acceptance criteria.** Insert without defaulted/timestamp fields compiles and stores them; derived `$jsonSchema` includes `createdAt`/`updatedAt` as required dates; the read type includes them without assertion.
- **Test plan.** typeAssertions (insert-optional/read-required), integration test for update-time `updatedAt`, golden validator including timestamps.
- **Open questions.** Custom timestamp field names (`timestamps: { createdAt: "ctime" }`) in v1?

### SCHEMA-7: Validation error DX

- **Priority** P1 | **Estimate** S | **Depends on** SCHEMA-3, SCHEMA-4
- **Context.** Curated errors are a protected differentiator (plan/03 §8). The spike pinned the exact server payload; turn both failure sources into one readable surface.
- **Design.** `PipeSafeValidationError` (client, SCHEMA-4) and `PipeSafeServerValidationError` (wraps `MongoServerError` code 121: map code→name ourselves since `codeName` is undefined on write errors — spike finding; parse `errInfo.details.schemaRulesNotSatisfied` into flat `{ path, keyword, reason, consideredValue, consideredType }[]`; keep `failingDocumentId` and the raw `errInfo`). Both share an `issues`-like shape so app code handles one contract. Document loudly: `validationAction: "warn"` violations are _client-invisible_ (spike-proven) — server logs only.
- **Acceptance criteria.** The spike's recorded payloads parse into flat issues with correct dotted paths (incl. nested `properties` trees); non-121 errors pass through untouched; message format follows the CLAUDE.md grammar (`Field 'email' ...`).
- **Test plan.** Unit tests against captured `errInfo` fixtures from the spike; integration test asserting the wrapped error on a real rejected insert and on `insertMany` per-doc write errors.
- **Open questions.** Should `updateOne` 121s (no client validation in v1) get the same wrapper? (Yes — the parser is write-path-agnostic; confirm findOneAndUpdate error shape, which surfaces as a command error not a write error.)
