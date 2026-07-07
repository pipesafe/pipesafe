/**
 * SPIKE: RLS-style policy → predicate compilation and injection for MongoDB
 * (EPIC-M, plan/trd/EPIC-M-rls-policy-engine.md). EXECUTED, not a sketch.
 *
 * Purpose: empirically ground the RLS policy engine design — the migration
 * unlock for Supabase → Atlas+PipeSafe (research: supabase-architecture.md §4,
 * supabase-market.md §3-4). Policies are typed predicates over (doc, claims);
 * this spike proves/loses each enforcement seam: find-filter injection,
 * aggregation $match prepend, the $lookup/$unionWith/$graphLookup bypass
 * holes and what closing them requires, write-filter ANDing, WITH CHECK
 * insert validation, $expr claim-injection safety, change-stream predicate
 * composition (EPIC-L seam), and fail-closed denial DX (designed AGAINST
 * Supabase's silent-permission-denied footgun).
 *
 * How to run (repo root; first run may download a mongod binary):
 *   bun run tsx plan/spikes/rls-policy-injection.spike.ts
 *
 * Status: EXECUTED 2026-07-07 against MongoMemoryReplSet (mongodb-memory-server
 * 10.2.x, mongodb driver 6.x, single-node replica set). All checks PASS.
 *
 * Findings summary (details printed by each scenario):
 *  1. Root-level $match prepend is NOT enforcement — THE key finding. A
 *     malicious pipeline reads any other collection wholesale via
 *     pipeline-form $lookup (and $unionWith, and $graphLookup): with only the
 *     root collection's policy injected, alice's aggregate leaked tenant-2
 *     secrets through `$lookup: { from: "secrets", pipeline: [...] }`.
 *     Closing it requires RECURSIVE traversal: every $lookup/$unionWith
 *     sub-pipeline (including nested $lookup-inside-$lookup and $facet
 *     branches) gets the FOREIGN collection's read policy prepended, resolved
 *     against the same claims context. Verified leak → verified closed.
 *  2. Shorthand $lookup (localField/foreignField, no pipeline) accepts a
 *     coexisting injected `pipeline: [{ $match: policy }]` (MongoDB ≥5.0
 *     "concise correlated subquery" form) — the policy ANDs with the equality
 *     join, so shorthand lookups are closable WITHOUT rewriting to let/pipeline
 *     form. Bare-string $unionWith must be rewritten to object form.
 *  3. $graphLookup has NO sub-pipeline and therefore NO injection point; a
 *     literal `startWith` value pulled tenant-2 docs across the boundary.
 *     Fail-closed rule: deny $graphLookup targeting any policy-bearing
 *     collection (same for $out/$merge in the read path).
 *  4. Writes: compiling the write policy as `$and: [policyFilter, userFilter]`
 *     makes cross-tenant updateOne/deleteOne report matchedCount/deletedCount
 *     0 — Postgres-RLS-equivalent semantics (row invisible, not an error).
 *     Insert WITH CHECK is client-side predicate evaluation before the driver
 *     call; a cross-tenant insert throws a typed PolicyDeniedError and writes
 *     nothing. Update WITH CHECK needs $set inspection (post-image escape
 *     hole demonstrated at the design level, checked here for $set only).
 *  5. $expr claim injection is REAL: with claims.sub = "$tenantId" (attacker-
 *     controlled string), `$eq: ["$ownerId", claims.sub]` interpreted the
 *     claim as a FIELD PATH and matched a doc where ownerId === tenantId.
 *     `{ $literal: claims.sub }` and plain query-context equality
 *     (`{ ownerId: claims.sub }`) both stayed literal and matched nothing.
 *     Rule: compile to query-context filters by default; any $expr compilation
 *     MUST wrap claim values in $literal. Values always as BSON, never string
 *     interpolation — but BSON alone is NOT sufficient inside $expr.
 *  6. Change streams: the same compiled read policy, key-prefixed onto
 *     `fullDocument.*`, works as a change-stream pipeline $match — a
 *     subscriber received exactly its permitted inserts. BUT: (a) without
 *     `fullDocument: "updateLookup"`, update events carry no fullDocument and
 *     are silently dropped by the policy $match — permitted updates become
 *     invisible (fail-closed but lossy); (b) delete events NEVER carry
 *     fullDocument — policy-filtered deletes are invisible unless the
 *     collection enables changeStreamPreAndPostImages and the predicate also
 *     matches `fullDocumentBeforeChange.*` (verified working after collMod).
 *     This is the EPIC-L composition contract.
 *  7. Fail-closed DX: unknown collection / missing policy → typed
 *     PolicyDeniedError carrying { collection, operation, principal } and an
 *     actionable message — an exception, never a silent empty result. The
 *     same denial fires when a $lookup targets an unregistered collection.
 *     Service-role bypass is an explicit context constructor, not a flag on
 *     user claims.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  MongoClient,
  type ChangeStreamDocument,
  type Db,
  type Document,
  type Filter,
} from "mongodb";

/* ------------------------------------------------------------------ */
/* Test harness                                                         */
/* ------------------------------------------------------------------ */

const failures: string[] = [];
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures.push(label);
}

const ids = (docs: Document[]): string =>
  docs
    .map((d) => String(d._id))
    .sort()
    .join(",");

/* ------------------------------------------------------------------ */
/* Domain schemas (stand-ins for PipeSafe collection schemas)           */
/* ------------------------------------------------------------------ */

interface Doc {
  _id: string;
  tenantId: string;
  ownerId: string;
  visibility: "team" | "private";
  title: string;
}

interface Secret {
  _id: string;
  tenantId: string;
  ownerId: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/* Policy model: typed predicates over (schema, claims)                 */
/* ------------------------------------------------------------------ */

interface Claims {
  sub: string;
  tenantId: string;
  role: "user" | "admin";
}

/** Explicit service context — the ONLY bypass path (never a claims flag). */
type PolicyCtx =
  | { kind: "principal"; claims: Claims }
  | { kind: "service"; reason: string };

const principal = (claims: Claims): PolicyCtx => ({
  kind: "principal",
  claims,
});
const serviceContext = (reason: string): PolicyCtx => ({
  kind: "service",
  reason,
});

/**
 * Per-collection policy. In the real engine `read`/`write` return a typed
 * MatchQuery<Schema> validated against the collection schema at compile time
 * (the PipeSafe differentiator vs SQL-string policies); here plain driver
 * Filter<T> stands in. `read` ≈ Postgres USING for SELECT; `write` ≈ USING
 * for UPDATE/DELETE; `check` ≈ WITH CHECK for INSERT (and $set inspection
 * on update).
 */
interface CollectionPolicy<TDoc extends Document> {
  read: (claims: Claims) => Filter<TDoc>;
  write: (claims: Claims) => Filter<TDoc>;
  check: (claims: Claims, doc: TDoc) => boolean;
}

class PolicyDeniedError extends Error {
  readonly collection: string;
  readonly operation: string;
  readonly principal: string;
  constructor(
    collection: string,
    operation: string,
    ctx: PolicyCtx,
    why: string
  ) {
    const who = ctx.kind === "service" ? "service" : ctx.claims.sub;
    super(
      `Policy denied: ${operation} on '${collection}' for principal '${who}' — ${why}`
    );
    this.name = "PolicyDeniedError";
    this.collection = collection;
    this.operation = operation;
    this.principal = who;
  }
}

/** Registry: fail-closed — no policy entry means DENY, not allow. */
const registry = new Map<string, CollectionPolicy<Document>>();

function readFilter(collection: string, ctx: PolicyCtx): Filter<Document> {
  if (ctx.kind === "service") return {};
  const policy = registry.get(collection);
  if (!policy) {
    throw new PolicyDeniedError(
      collection,
      "read",
      ctx,
      "no policy is registered for this collection (fail-closed default). " +
        "Register a policy or use an explicit service context."
    );
  }
  return policy.read(ctx.claims);
}

function writeFilter(collection: string, ctx: PolicyCtx): Filter<Document> {
  if (ctx.kind === "service") return {};
  const policy = registry.get(collection);
  if (!policy) {
    throw new PolicyDeniedError(
      collection,
      "write",
      ctx,
      "no policy is registered for this collection (fail-closed default)."
    );
  }
  return policy.write(ctx.claims);
}

/* ------------------------------------------------------------------ */
/* Guarded operations (the interceptor bodies, EPIC-D shape)            */
/* ------------------------------------------------------------------ */

async function guardedFind(
  db: Db,
  collection: string,
  ctx: PolicyCtx,
  userFilter: Filter<Document> = {}
): Promise<Document[]> {
  const filter = { $and: [readFilter(collection, ctx), userFilter] };
  return db.collection(collection).find(filter).toArray();
}

/**
 * Recursive policy injection into an aggregation pipeline. Root gets the
 * collection's read policy prepended; every stage that pulls in ANOTHER
 * collection gets that collection's policy injected into its sub-pipeline
 * (recursively, so nested $lookups are covered). Stages with no injection
 * point ($graphLookup) and write-out stages ($out/$merge) are denied.
 */
function injectPolicies(
  rootCollection: string,
  stages: Document[],
  ctx: PolicyCtx
): Document[] {
  return [
    { $match: readFilter(rootCollection, ctx) },
    ...stages.map((stage) => rewriteStage(stage, ctx)),
  ];
}

function rewriteStage(stage: Document, ctx: PolicyCtx): Document {
  if (stage.$lookup !== undefined) {
    const lookup = { ...(stage.$lookup as Document) };
    const from = String(lookup.from);
    const sub = ((lookup.pipeline as Document[] | undefined) ?? []).map((s) =>
      rewriteStage(s, ctx)
    );
    // Works for BOTH forms: pipeline-form lookups get the policy prepended;
    // shorthand localField/foreignField lookups accept a coexisting pipeline
    // (MongoDB >=5.0) that ANDs with the equality join.
    lookup.pipeline = [{ $match: readFilter(from, ctx) }, ...sub];
    return { $lookup: lookup };
  }
  if (stage.$unionWith !== undefined) {
    const u = stage.$unionWith as string | Document;
    const coll = typeof u === "string" ? u : String(u.coll);
    const sub = (
      typeof u === "string" ?
        []
      : ((u.pipeline as Document[] | undefined) ?? [])).map((s) =>
      rewriteStage(s, ctx)
    );
    return {
      $unionWith: {
        coll,
        pipeline: [{ $match: readFilter(coll, ctx) }, ...sub],
      },
    };
  }
  if (stage.$facet !== undefined) {
    const facet = stage.$facet as Record<string, Document[]>;
    const rewritten: Record<string, Document[]> = {};
    for (const [name, sub] of Object.entries(facet)) {
      rewritten[name] = sub.map((s) => rewriteStage(s, ctx));
    }
    return { $facet: rewritten };
  }
  if (stage.$graphLookup !== undefined) {
    const from = String((stage.$graphLookup as Document).from);
    throw new PolicyDeniedError(
      from,
      "read",
      ctx,
      "'$graphLookup' has no sub-pipeline to carry a policy predicate; " +
        "it cannot be policy-guarded and is denied on policy-bearing collections."
    );
  }
  if (stage.$out !== undefined || stage.$merge !== undefined) {
    throw new PolicyDeniedError(
      "(pipeline)",
      "write",
      ctx,
      "'$out'/'$merge' write through the read path and bypass write policies; denied."
    );
  }
  return stage;
}

async function guardedAggregate(
  db: Db,
  collection: string,
  ctx: PolicyCtx,
  stages: Document[]
): Promise<Document[]> {
  return db
    .collection(collection)
    .aggregate(injectPolicies(collection, stages, ctx))
    .toArray();
}

async function guardedUpdateOne(
  db: Db,
  collection: string,
  ctx: PolicyCtx,
  userFilter: Filter<Document>,
  update: Document
): Promise<{ matchedCount: number }> {
  // WITH CHECK on update ($set inspection): reject $set values that would
  // move the doc outside the writer's policy. (Full post-image validation is
  // an RLS ticket; $set-field checking covers the common escalation.)
  if (ctx.kind === "principal") {
    const policy = registry.get(collection);
    const set = update.$set as Document | undefined;
    if (policy && set) {
      const probe = { ...set } as never;
      if (
        ("tenantId" in set || "ownerId" in set) &&
        !policy.check(ctx.claims, probe)
      ) {
        throw new PolicyDeniedError(
          collection,
          "update",
          ctx,
          `'$set' would move the document outside your write policy (WITH CHECK failed on ${JSON.stringify(set)}).`
        );
      }
    }
  }
  const res = await db
    .collection(collection)
    .updateOne({ $and: [writeFilter(collection, ctx), userFilter] }, update);
  return { matchedCount: res.matchedCount };
}

async function guardedDeleteOne(
  db: Db,
  collection: string,
  ctx: PolicyCtx,
  userFilter: Filter<Document>
): Promise<{ deletedCount: number }> {
  const res = await db
    .collection(collection)
    .deleteOne({ $and: [writeFilter(collection, ctx), userFilter] });
  return { deletedCount: res.deletedCount };
}

async function guardedInsertOne(
  db: Db,
  collection: string,
  ctx: PolicyCtx,
  doc: Document
): Promise<void> {
  if (ctx.kind === "principal") {
    const policy = registry.get(collection);
    if (!policy) {
      throw new PolicyDeniedError(
        collection,
        "insert",
        ctx,
        "no policy is registered for this collection (fail-closed default)."
      );
    }
    if (!policy.check(ctx.claims, doc)) {
      throw new PolicyDeniedError(
        collection,
        "insert",
        ctx,
        `document failed WITH CHECK (tenantId=${String(doc.tenantId)}, ownerId=${String(doc.ownerId)} vs your claims).`
      );
    }
  }
  await db.collection(collection).insertOne(doc);
}

/* ------------------------------------------------------------------ */
/* Change-stream predicate composition (EPIC-L seam)                    */
/* ------------------------------------------------------------------ */

/** Rewrite a compiled query-context filter so keys match change-stream event
 *  fields (`fullDocument.` prefix, optionally also `fullDocumentBeforeChange.`). */
function prefixFilterKeys(filter: Document, prefix: string): Document {
  const out: Document = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      out[key] = (value as Document[]).map((f) => prefixFilterKeys(f, prefix));
    } else if (key.startsWith("$")) {
      out[key] = value; // other top-level operators pass through untouched
    } else {
      out[`${prefix}${key}`] = value;
    }
  }
  return out;
}

async function drain(
  stream: {
    tryNext: () => Promise<ChangeStreamDocument<Document> | null>;
  },
  label: string
): Promise<ChangeStreamDocument<Document>[]> {
  const events: ChangeStreamDocument<Document>[] = [];
  for (;;) {
    const ev = await stream.tryNext();
    if (ev === null) break;
    events.push(ev);
  }
  console.log(
    `  [stream:${label}] received: ${
      events.map((e) => `${e.operationType}`).join(", ") || "(none)"
    }`
  );
  return events;
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("starting MongoMemoryReplSet (1 node)...");
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replSet.getUri());
  await client.connect();
  const db: Db = client.db("app");

  try {
    /* ---------------------------------------------------------------- */
    console.log("\n[0] seed: multi-tenant docs + secrets, register policies");
    /* ---------------------------------------------------------------- */
    const docs = db.collection<Doc>("docs");
    const secrets = db.collection<Secret>("secrets");
    await docs.insertMany([
      {
        _id: "d1",
        tenantId: "t1",
        ownerId: "alice",
        visibility: "team",
        title: "t1 team doc",
      },
      {
        _id: "d2",
        tenantId: "t1",
        ownerId: "alice",
        visibility: "private",
        title: "alice private",
      },
      {
        _id: "d3",
        tenantId: "t1",
        ownerId: "adam",
        visibility: "private",
        title: "adam private",
      },
      {
        _id: "d4",
        tenantId: "t1",
        ownerId: "adam",
        visibility: "team",
        title: "adam team",
      },
      {
        _id: "d5",
        tenantId: "t2",
        ownerId: "bob",
        visibility: "team",
        title: "t2 team doc",
      },
      {
        _id: "d6",
        tenantId: "t2",
        ownerId: "bob",
        visibility: "private",
        title: "bob private",
      },
      // ownerId === tenantId on purpose: the $expr-injection tripwire ([4])
      {
        _id: "d7",
        tenantId: "t1",
        ownerId: "t1",
        visibility: "private",
        title: "system doc",
      },
      {
        _id: "d8",
        tenantId: "t1",
        ownerId: "alice",
        visibility: "private",
        title: "sacrificial",
      },
    ]);
    await secrets.insertMany([
      { _id: "s1", tenantId: "t1", ownerId: "alice", value: "alice-key" },
      { _id: "s2", tenantId: "t1", ownerId: "adam", value: "adam-key" },
      { _id: "s3", tenantId: "t2", ownerId: "bob", value: "bob-key" },
    ]);
    // NOTE: db also implicitly "contains" unregistered collections — [6]
    // proves access to them is denied, not silently empty.

    registry.set("docs", {
      // tenant fence + (team-visible OR own doc); admins see the whole tenant
      read: (c) => ({
        $and: [
          { tenantId: c.tenantId },
          c.role === "admin" ?
            {}
          : { $or: [{ visibility: "team" }, { ownerId: c.sub }] },
        ],
      }),
      // only your own docs are writable (admins: tenant-wide)
      write: (c) =>
        c.role === "admin" ?
          { tenantId: c.tenantId }
        : { tenantId: c.tenantId, ownerId: c.sub },
      check: (c, doc) =>
        doc.tenantId === c.tenantId &&
        (c.role === "admin" || doc.ownerId === c.sub),
    });
    registry.set("secrets", {
      read: (c) => ({ tenantId: c.tenantId, ownerId: c.sub }), // owner-only
      write: (c) => ({ tenantId: c.tenantId, ownerId: c.sub }),
      check: (c, doc) => doc.tenantId === c.tenantId && doc.ownerId === c.sub,
    });

    const alice = principal({ sub: "alice", tenantId: "t1", role: "user" });
    const adam = principal({ sub: "adam", tenantId: "t1", role: "admin" });
    const bob = principal({ sub: "bob", tenantId: "t2", role: "user" });

    /* ---------------------------------------------------------------- */
    console.log("\n[1] reads: injected predicate → exact permitted rows");
    /* ---------------------------------------------------------------- */
    const aliceDocs = await guardedFind(db, "docs", alice);
    const adamDocs = await guardedFind(db, "docs", adam);
    const bobDocs = await guardedFind(db, "docs", bob);
    console.log(`  alice(user,t1): ${ids(aliceDocs)}`);
    console.log(`  adam(admin,t1): ${ids(adamDocs)}`);
    console.log(`  bob(user,t2):   ${ids(bobDocs)}`);
    check(
      ids(aliceDocs) === "d1,d2,d4,d8",
      "alice sees team docs + her own, nothing cross-tenant"
    );
    check(
      ids(adamDocs) === "d1,d2,d3,d4,d7,d8",
      "admin sees the whole tenant, not t2"
    );
    check(ids(bobDocs) === "d5,d6", "bob sees only tenant-2 rows");
    const aliceFiltered = await guardedFind(db, "docs", alice, {
      visibility: "private",
    });
    check(
      ids(aliceFiltered) === "d2,d8",
      "user filter ANDs with the policy (cannot widen it)"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[2] aggregate: root $match prepend alone is NOT enforcement ($lookup bypass)"
    );
    /* ---------------------------------------------------------------- */
    const maliciousStages: Document[] = [
      { $match: { visibility: "team" } },
      {
        $lookup: { from: "secrets", pipeline: [{ $match: {} }], as: "leak" },
      },
    ];
    // naive guard: policy $match prepended at the ROOT only
    const naive = await db
      .collection("docs")
      .aggregate([{ $match: readFilter("docs", alice) }, ...maliciousStages])
      .toArray();
    const naiveLeaked = naive.flatMap((d) => (d.leak as Secret[]) ?? []);
    console.log(
      `  naive: alice's $lookup pulled secrets: ${ids(naiveLeaked)} (s3 is tenant-2!)`
    );
    check(
      naiveLeaked.some((s) => s.tenantId === "t2"),
      "BYPASS CONFIRMED: root-only injection leaks cross-tenant docs via pipeline-form $lookup"
    );

    const closed = await guardedAggregate(db, "docs", alice, maliciousStages);
    const closedLeaked = closed.flatMap((d) => (d.leak as Secret[]) ?? []);
    console.log(`  recursive guard: lookup now returns: ${ids(closedLeaked)}`);
    check(
      closedLeaked.length > 0 && closedLeaked.every((s) => s._id === "s1"),
      "closing the hole: foreign collection's policy injected into the $lookup sub-pipeline"
    );

    // shorthand $lookup (localField/foreignField) + coexisting injected pipeline
    const shorthand = await guardedAggregate(db, "docs", alice, [
      { $match: { _id: "d1" } },
      {
        $lookup: {
          from: "secrets",
          localField: "tenantId",
          foreignField: "tenantId",
          as: "joined",
        },
      },
    ]);
    const joined = (shorthand[0]?.joined as Secret[] | undefined) ?? [];
    console.log(
      `  shorthand lookup joined: ${ids(joined)} (s2 same-tenant but not alice's)`
    );
    check(
      ids(joined) === "s1",
      "shorthand $lookup accepts a coexisting injected pipeline (>=5.0); policy ANDs with the join"
    );

    // nested $lookup inside a $lookup sub-pipeline — traversal must recurse
    const nested = await guardedAggregate(db, "docs", alice, [
      { $match: { _id: "d1" } },
      {
        $lookup: {
          from: "secrets",
          pipeline: [
            {
              $lookup: {
                from: "docs",
                pipeline: [{ $match: {} }],
                as: "inner",
              },
            },
          ],
          as: "outer",
        },
      },
    ]);
    const outer = (nested[0]?.outer as Document[] | undefined) ?? [];
    const inner = outer.flatMap((s) => (s.inner as Doc[]) ?? []);
    check(
      outer.every((s) => (s as unknown as Secret).ownerId === "alice") &&
        inner.length > 0 &&
        inner.every((d) => ids(aliceDocs).includes(d._id)),
      "nested $lookup-inside-$lookup is guarded recursively at every depth"
    );

    // $unionWith: bare form leaks; guard rewrites to object form + policy
    const naiveUnion = await db
      .collection("docs")
      .aggregate([
        { $match: readFilter("docs", alice) },
        { $unionWith: "secrets" },
      ])
      .toArray();
    const guardedUnion = await guardedAggregate(db, "docs", alice, [
      { $unionWith: "secrets" },
    ]);
    console.log(
      `  $unionWith naive: ${ids(naiveUnion)} | guarded: ${ids(guardedUnion)}`
    );
    check(
      naiveUnion.some((d) => d._id === "s3") &&
        !guardedUnion.some((d) => d._id === "s2" || d._id === "s3"),
      "$unionWith bare form leaks; rewrite-to-pipeline-form + policy closes it"
    );

    // $graphLookup: no sub-pipeline exists → no injection point → deny
    const graphLeak = await db
      .collection("docs")
      .aggregate([
        { $match: readFilter("docs", alice) },
        { $limit: 1 },
        {
          $graphLookup: {
            from: "secrets",
            startWith: "t2", // literal — attacker-chosen constant
            connectFromField: "tenantId",
            connectToField: "tenantId",
            as: "leak",
          },
        },
      ])
      .toArray();
    const graphLeaked = (graphLeak[0]?.leak as Secret[] | undefined) ?? [];
    console.log(
      `  $graphLookup pulled: ${ids(graphLeaked)} with literal startWith "t2"`
    );
    let graphDenied = false;
    try {
      await guardedAggregate(db, "docs", alice, [
        {
          $graphLookup: {
            from: "secrets",
            startWith: "t2",
            connectFromField: "tenantId",
            connectToField: "tenantId",
            as: "leak",
          },
        },
      ]);
    } catch (err) {
      graphDenied = err instanceof PolicyDeniedError;
    }
    check(
      graphLeaked.some((s) => s.tenantId === "t2") && graphDenied,
      "$graphLookup leaks cross-tenant (no injection point) → guard must DENY it"
    );
    let mergeDenied = false;
    try {
      await guardedAggregate(db, "docs", alice, [{ $merge: { into: "docs" } }]);
    } catch (err) {
      mergeDenied = err instanceof PolicyDeniedError;
    }
    check(
      mergeDenied,
      "$merge/$out in the read path are denied (write-through bypass)"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[3] writes: policy ANDed into update/delete; WITH CHECK on insert"
    );
    /* ---------------------------------------------------------------- */
    const crossUpdate = await guardedUpdateOne(
      db,
      "docs",
      bob,
      { _id: "d1" },
      {
        $set: { title: "pwned" },
      }
    );
    const d1After = await docs.findOne({ _id: "d1" });
    check(
      crossUpdate.matchedCount === 0 && d1After?.title === "t1 team doc",
      "cross-tenant update: matchedCount 0, document untouched (row invisible, RLS semantics)"
    );
    const ownUpdate = await guardedUpdateOne(
      db,
      "docs",
      alice,
      { _id: "d2" },
      {
        $set: { title: "alice private v2" },
      }
    );
    check(
      ownUpdate.matchedCount === 1,
      "own-document update matches through the ANDed filter"
    );

    let escalationDenied = false;
    try {
      await guardedUpdateOne(
        db,
        "docs",
        alice,
        { _id: "d2" },
        {
          $set: { tenantId: "t2" },
        }
      );
    } catch (err) {
      escalationDenied = err instanceof PolicyDeniedError;
    }
    check(
      escalationDenied,
      "update WITH CHECK: '$set: { tenantId: t2 }' (moving the row out of policy) is rejected"
    );

    const crossDelete = await guardedDeleteOne(db, "docs", bob, { _id: "d8" });
    const ownDelete = await guardedDeleteOne(db, "docs", alice, { _id: "d8" });
    check(
      crossDelete.deletedCount === 0 && ownDelete.deletedCount === 1,
      "cross-tenant delete deletes nothing; owner delete succeeds"
    );

    const before = await docs.countDocuments();
    let insertDenied: PolicyDeniedError | undefined;
    try {
      await guardedInsertOne(db, "docs", bob, {
        _id: "evil",
        tenantId: "t1", // bob is t2 — cross-tenant insert
        ownerId: "bob",
        visibility: "team",
        title: "planted",
      });
    } catch (err) {
      if (err instanceof PolicyDeniedError) insertDenied = err;
    }
    const after = await docs.countDocuments();
    console.log(
      `  insert denial message: ${insertDenied?.message ?? "(none)"}`
    );
    check(
      insertDenied !== undefined && before === after,
      "cross-tenant insert rejected client-side (WITH CHECK equivalent), nothing written"
    );
    await guardedInsertOne(db, "docs", bob, {
      _id: "d9",
      tenantId: "t2",
      ownerId: "bob",
      visibility: "private",
      title: "bob's new doc",
    });
    check(
      (await docs.countDocuments({ _id: "d9" })) === 1,
      "policy-passing insert goes through"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[4] $expr claim injection: field-path interpretation is real"
    );
    /* ---------------------------------------------------------------- */
    // Attacker controls a claim STRING (e.g. a display name synced into JWT):
    const evilSub = "$tenantId";
    const naiveExpr = await docs
      .find({ $expr: { $eq: ["$ownerId", evilSub] } })
      .toArray();
    const literalExpr = await docs
      .find({ $expr: { $eq: ["$ownerId", { $literal: evilSub }] } })
      .toArray();
    const queryCtx = await docs.find({ ownerId: evilSub }).toArray();
    console.log(
      `  naive $expr matched: ${ids(naiveExpr)} | $literal: ${ids(literalExpr)} | query-context: ${ids(queryCtx)}`
    );
    check(
      ids(naiveExpr) === "d7",
      "INJECTION CONFIRMED: claim string '$tenantId' interpreted as a FIELD PATH inside $expr"
    );
    check(
      literalExpr.length === 0 && queryCtx.length === 0,
      "wrapping claims in $literal (and plain query-context equality) stays literal — safe"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[5] change streams: same policy as a stream $match (EPIC-L seam)"
    );
    /* ---------------------------------------------------------------- */
    const alicePolicy = readFilter("docs", alice);
    const streamMatch = prefixFilterKeys(alicePolicy, "fullDocument.");
    console.log(`  compiled stream predicate: ${JSON.stringify(streamMatch)}`);

    // (a) inserts: default stream (no fullDocument option)
    const s1 = docs.watch([{ $match: streamMatch }], { maxAwaitTimeMS: 250 });
    await s1.tryNext(); // establish the stream point before writing
    await docs.insertOne({
      _id: "e1",
      tenantId: "t1",
      ownerId: "alice",
      visibility: "team",
      title: "evt t1",
    });
    await docs.insertOne({
      _id: "e2",
      tenantId: "t2",
      ownerId: "bob",
      visibility: "team",
      title: "evt t2",
    });
    await docs.updateOne({ _id: "e1" }, { $set: { title: "evt t1 v2" } });
    const ev1 = await drain(s1, "no-fullDocument");
    await s1.close();
    check(
      ev1.length === 1 &&
        ev1[0]?.operationType === "insert" &&
        (ev1[0] as { documentKey?: { _id?: string } }).documentKey?._id ===
          "e1",
      "subscriber receives ONLY its permitted insert (t2 insert filtered server-side)"
    );
    check(
      !ev1.some((e) => e.operationType === "update"),
      "FINDING: without fullDocument:'updateLookup', PERMITTED updates are dropped (no fullDocument to match)"
    );

    // (b) updates with fullDocument: "updateLookup"
    const s2 = docs.watch([{ $match: streamMatch }], {
      fullDocument: "updateLookup",
      maxAwaitTimeMS: 250,
    });
    await s2.tryNext();
    await docs.updateOne({ _id: "e1" }, { $set: { title: "evt t1 v3" } });
    await docs.updateOne({ _id: "e2" }, { $set: { title: "evt t2 v2" } });
    const ev2 = await drain(s2, "updateLookup");
    await s2.close();
    check(
      ev2.length === 1 &&
        ev2[0]?.operationType === "update" &&
        (ev2[0] as { documentKey?: { _id?: string } }).documentKey?._id ===
          "e1",
      "with updateLookup the policy matches update post-images; cross-tenant update filtered"
    );

    // (c) deletes: no fullDocument ever → invisible unless pre-images enabled
    const s3 = docs.watch([{ $match: streamMatch }], {
      fullDocument: "updateLookup",
      maxAwaitTimeMS: 250,
    });
    await s3.tryNext();
    await docs.deleteOne({ _id: "e1" });
    const ev3 = await drain(s3, "delete-no-preimage");
    await s3.close();
    check(
      ev3.length === 0,
      "FINDING: deletes carry no fullDocument — a fullDocument-keyed policy drops PERMITTED deletes"
    );

    let preImageWorks = false;
    try {
      await db.command({
        collMod: "docs",
        changeStreamPreAndPostImages: { enabled: true },
      });
      await docs.insertOne({
        _id: "e3",
        tenantId: "t1",
        ownerId: "alice",
        visibility: "team",
        title: "evt 3",
      });
      const combinedMatch = {
        $or: [
          streamMatch,
          prefixFilterKeys(alicePolicy, "fullDocumentBeforeChange."),
        ],
      };
      const s4 = docs.watch([{ $match: combinedMatch }], {
        fullDocument: "updateLookup",
        fullDocumentBeforeChange: "whenAvailable",
        maxAwaitTimeMS: 250,
      });
      await s4.tryNext();
      await docs.deleteOne({ _id: "e3" });
      await docs.deleteOne({ _id: "e2" }); // cross-tenant delete must stay invisible
      const ev4 = await drain(s4, "delete-preimage");
      await s4.close();
      preImageWorks =
        ev4.length === 1 &&
        ev4[0]?.operationType === "delete" &&
        (ev4[0] as { documentKey?: { _id?: string } }).documentKey?._id ===
          "e3";
    } catch (err) {
      console.log(
        `  pre-image path unavailable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    check(
      preImageWorks,
      "changeStreamPreAndPostImages + fullDocumentBeforeChange predicate recovers permitted deletes only"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[6] fail-closed: missing policy is a typed error, never a silent empty"
    );
    /* ---------------------------------------------------------------- */
    let denial: PolicyDeniedError | undefined;
    try {
      await guardedFind(db, "audit_logs", alice); // no registered policy
    } catch (err) {
      if (err instanceof PolicyDeniedError) denial = err;
    }
    console.log(`  denial: ${denial?.message ?? "(none)"}`);
    check(
      denial !== undefined &&
        denial.collection === "audit_logs" &&
        denial.operation === "read" &&
        denial.principal === "alice",
      "unknown collection → typed PolicyDeniedError with {collection, operation, principal}"
    );

    let lookupDenied = false;
    try {
      await guardedAggregate(db, "docs", alice, [
        { $lookup: { from: "audit_logs", pipeline: [], as: "x" } },
      ]);
    } catch (err) {
      lookupDenied = err instanceof PolicyDeniedError;
    }
    check(
      lookupDenied,
      "$lookup targeting an unregistered collection denies the whole pipeline (fail-closed recursion)"
    );

    const svc = await guardedFind(
      db,
      "docs",
      serviceContext("nightly billing job")
    );
    check(
      svc.some((d) => d.tenantId === "t1") &&
        svc.some((d) => d.tenantId === "t2"),
      "explicit service context (reason required) bypasses policies — the ONLY bypass path"
    );

    /* ---------------------------------------------------------------- */
    console.log("\n==== SUMMARY ====");
    if (failures.length === 0) {
      console.log("ALL CHECKS PASSED");
    } else {
      console.log(`${String(failures.length)} FAILURES:`);
      for (const f of failures) console.log(`  - ${f}`);
      throw new Error(`spike failed: ${String(failures.length)} checks`);
    }
  } finally {
    await client.close();
    await replSet.stop();
  }
}

await main();
