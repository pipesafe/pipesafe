/**
 * SPIKE: Canonical pipeline hash + state:modified selection (EPIC-F)
 *
 * Purpose:   Empirically answer the open questions behind
 *            plan/04-transform-roadmap.md §4 and plan/trd/EPIC-F-state-artifacts-selectors.md:
 *            (1) can we obtain the built stage array from real Pipeline/Model
 *            instances with today's public API; (2) implement + verify a
 *            canonical-JSON sha256 hash (key order, Date/RegExp/ObjectId,
 *            undefined, functions, custom() stages); (3) simulate
 *            state:modified diffing, descendant expansion, and retry-failed
 *            selection over two manifest snapshots of a real toy DAG.
 *
 * How to run: bun run tsx plan/spikes/pipeline-hash.spike.ts   (from repo root)
 *            (spawns itself once with --child to prove cross-process hash
 *            stability; requires no MongoDB server — pure in-process)
 *
 * Status:    EXECUTED 2026-07-03 against @pipesafe/core + @pipesafe/manifold
 *            workspace dist builds. All 22 checks pass.
 *
 * Findings summary (details in EPIC-F TRD "Spike findings"):
 *  - F1  Pipeline.getPipeline() and Model.getPipelineStages()/buildPipeline()
 *        are public and return the built stage array — no new core API is
 *        required to READ stages. BUT getPipeline() returns the live internal
 *        array (mutating it corrupts the instance), and stage objects are
 *        shared across chained Pipeline instances (shallow [...spread] in
 *        _chain). A serialization API must deep-copy (STATE-1).
 *  - F2  After a terminal .merge()/.out(), getPipeline() types as `never`
 *        (PreviousStageDocs = never) — callable only via cast. Model works
 *        around this internally; core needs an explicit `toStages()` (STATE-1).
 *  - F3  Model.buildPipeline() bakes the RESOLVED output target (incl.
 *        materialize.db) into the terminal $merge/$out — hashing it makes
 *        prod-vs-CI manifests differ on every model. Hash
 *        getPipelineStages() (no output stage) + a separate unrendered
 *        configHash instead. Confirms the plan-04 "unrendered" rule.
 *  - F4  RegExp survives into the stage array as a live RegExp; naive
 *        JSON.stringify serializes it as {} — two DIFFERENT regexes hash
 *        identical (demonstrated collision). Date values also survive as Date
 *        (JSON collides them with their ISO string). Canonicalizer must emit
 *        tagged forms ($regex/$options, $date, $oid).
 *  - F5  Functions can enter stages via custom() payloads; JSON.stringify
 *        silently DROPS them (another demonstrated collision). Canonical
 *        hash must throw on functions. No closures appear in stage arrays
 *        built by the typed builders themselves — only via custom().
 *  - F6  Hash is stable across object-key insertion order and across
 *        separate OS processes; sensitive to $gt 5→6; custom() stages hash
 *        fine (they are plain documents).
 *  - F7  state:modified + descendant expansion + retry-failed all work as
 *        pure functions over {pipelineHash, configHash, childMap} +
 *        run-results — no runtime classes needed by consumers.
 *  - F8  Model exposes getUpstreamModel()/getAncestorsFromStages() — enough
 *        to emit deps + lookupDeps for the manifest writer today (modulo the
 *        EPIC-A graph fix inside Project itself).
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { Collection, type Document } from "@pipesafe/core";
import { Model, isModel } from "@pipesafe/manifold";
import { ObjectId } from "mongodb";

// ---------------------------------------------------------------------------
// Tiny assertion helper (spike-grade)
// ---------------------------------------------------------------------------
let checks = 0;
let failures = 0;
function check(name: string, cond: boolean): void {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
}

// ---------------------------------------------------------------------------
// 1. Canonical pipeline hash — the real implementation candidate
// ---------------------------------------------------------------------------

export const HASH_VERSION = 1;

/**
 * Canonical JSON: recursively sorted object keys; tagged forms for values
 * JSON cannot represent faithfully (Date, RegExp, BSON, undefined-in-array,
 * non-finite numbers); throws on functions (nothing deterministic to hash).
 * Object values that are `undefined` are dropped (mirrors JSON.stringify,
 * and MongoDB's driver ignoreUndefined-style semantics).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) return `{"$nonFinite":"${String(n)}"}`;
    return JSON.stringify(n);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "undefined") return `{"$undefined":true}`;
  if (t === "bigint") return `{"$numberLong":"${String(value)}"}`;
  if (t === "function") {
    throw new TypeError(
      "canonicalJson: functions cannot be canonically hashed - " +
        "reject at serialization time (custom() payloads may contain them)"
    );
  }
  if (value instanceof Date)
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  if (value instanceof RegExp) {
    const flags = [...value.flags].sort().join("");
    return `{"$options":${JSON.stringify(flags)},"$regex":${JSON.stringify(value.source)}}`;
  }
  if (value instanceof ObjectId) return `{"$oid":"${value.toHexString()}"}`;
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  // Other BSON types carry _bsontype; tag generically via their string form.
  const obj = value as Record<string, unknown>;
  if (typeof obj["_bsontype"] === "string") {
    return `{"$bson":${JSON.stringify(obj["_bsontype"])},"$value":${JSON.stringify(String(value))}}`;
  }
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // drop undefined-valued keys
    .sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

export function canonicalPipelineHash(stages: Document[]): string {
  const digest = createHash("sha256")
    .update(canonicalJson(stages))
    .digest("hex");
  return `sha256:v${String(HASH_VERSION)}:${digest}`;
}

// ---------------------------------------------------------------------------
// Child mode: print the hash of a fixed pipeline and exit (cross-process check)
// ---------------------------------------------------------------------------

function fixedFixtureStages(): Document[] {
  return [
    {
      $match: {
        amount: { $gt: 5 },
        name: /foo/i,
        at: new Date("2026-01-01T00:00:00Z"),
      },
    },
    { $set: { day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } } },
  ];
}

if (process.argv.includes("--child")) {
  process.stdout.write(canonicalPipelineHash(fixedFixtureStages()));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Toy schemas + real Pipeline/Model instances
// ---------------------------------------------------------------------------

type RawEvent = {
  eventId: string;
  userId: string;
  status: "ok" | "err";
  amount: number;
  name: string;
  receivedAt: Date;
};
type User = { _id: string; plan: "free" | "pro" };

const rawEvents = new Collection<RawEvent>({ collectionName: "raw_events" });
const users = new Collection<User>({ collectionName: "users" });

function makeStgEvents(gt: number) {
  return new Model({
    name: "stg_events",
    from: rawEvents,
    pipeline: (p) =>
      p
        .match({ amount: { $gt: gt }, name: /foo/i })
        .set({ day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } }),
    materialize: {
      type: "collection",
      db: "prod_analytics", // env-specific on purpose (finding F3)
      mode: Model.Mode.Upsert,
    },
  });
}

const stgEvents = makeStgEvents(5);

const userDim = new Model({
  name: "user_dim",
  from: users,
  pipeline: (p) => p.match({ plan: "pro" }),
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

// (daily_metrics is constructed per-snapshot inside allModels() below, so the
// v1/v2 manifests each capture a coherent graph.)

async function main(): Promise<void> {
  console.log("== 1. Obtaining stage arrays from public API ==");

  const p1 = rawEvents
    .aggregate()
    .match({ amount: { $gt: 5 }, name: /foo/i })
    .set({ day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } });
  const stages = p1.getPipeline();
  console.log("Pipeline.getPipeline():", JSON.stringify(stages));
  check(
    "getPipeline() returns built stage array",
    stages.length === 2 && "$match" in (stages[0] ?? {})
  );
  const matchStage = stages[0] as { $match: { name: unknown } };
  check(
    "RegExp survives as live RegExp in stage array",
    matchStage.$match.name instanceof RegExp
  );

  // Live-reference hazard: mutating the returned array corrupts the instance.
  const before = p1.getPipeline().length;
  p1.getPipeline().push({ $limit: 1 });
  const after = p1.getPipeline().length;
  check(
    "FINDING F1: getPipeline() returns LIVE internal array (mutation visible)",
    after === before + 1
  );
  p1.getPipeline().pop(); // restore

  // Shared stage objects across chained instances (shallow spread in _chain).
  const p2 = p1.limit(10);
  const p2Stages = p2.getPipeline() as Document[];
  check(
    "FINDING F1b: stage objects shared between parent and child pipelines",
    p2Stages[0] === p1.getPipeline()[0]
  );

  // Terminal stage typing: .merge() narrows docs to never; getPipeline() types
  // as never and needs a cast — compile-time hole for artifact writers (F2).
  const terminal = rawEvents
    .aggregate()
    .match({ status: "ok" })
    .merge({ into: "ok_events" });
  const terminalStages = terminal.getPipeline() as unknown as Document[];
  check(
    "FINDING F2: terminal pipeline stages readable only via cast",
    terminalStages.length === 2
  );

  console.log("\n== 2. Model stage access: resolved vs unresolved ==");
  const modelStages = stgEvents.getPipelineStages();
  const fullStages = stgEvents.buildPipeline();
  console.log("getPipelineStages():", JSON.stringify(modelStages));
  console.log(
    "buildPipeline() terminal stage:",
    JSON.stringify(fullStages[fullStages.length - 1])
  );
  check("getPipelineStages() excludes output stage", modelStages.length === 2);
  const lastStage = fullStages[fullStages.length - 1] as {
    $merge?: { into?: { db?: string; coll?: string } };
  };
  check(
    "FINDING F3: buildPipeline() bakes RESOLVED db into $merge.into",
    lastStage.$merge?.into?.db === "prod_analytics"
  );

  console.log("\n== 3. Canonical hash properties ==");

  // (a) Key-insertion-order insensitivity.
  const hA = canonicalPipelineHash(
    rawEvents
      .aggregate()
      .match({ amount: { $gt: 5 }, status: "ok" })
      .getPipeline()
  );
  const hB = canonicalPipelineHash(
    rawEvents
      .aggregate()
      .match({ status: "ok", amount: { $gt: 5 } })
      .getPipeline()
  );
  check("insensitive to object key insertion order", hA === hB);

  // (b) Semantic sensitivity: $gt 5 -> 6.
  const hC = canonicalPipelineHash(
    rawEvents
      .aggregate()
      .match({ amount: { $gt: 6 }, status: "ok" })
      .getPipeline()
  );
  check("sensitive to semantic change ($gt 5 -> 6)", hA !== hC);

  // (c) Naive JSON collides distinct RegExps; canonical does not.
  const reFoo = rawEvents.aggregate().match({ name: /foo/i }).getPipeline();
  const reBar = rawEvents.aggregate().match({ name: /bar/g }).getPipeline();
  const naive = (s: Document[]) =>
    createHash("sha256").update(JSON.stringify(s)).digest("hex");
  check(
    "FINDING F4: naive JSON.stringify COLLIDES distinct RegExps",
    naive(reFoo) === naive(reBar)
  );
  check(
    "canonical hash distinguishes distinct RegExps",
    canonicalPipelineHash(reFoo) !== canonicalPipelineHash(reBar)
  );

  // (d) Date vs identical ISO string: naive collides, canonical does not.
  const d = new Date("2026-01-01T00:00:00.000Z");
  const withDate = [{ $match: { receivedAt: { $gt: d } } }];
  const withString = [{ $match: { receivedAt: { $gt: d.toISOString() } } }];
  check(
    "FINDING F4b: naive JSON COLLIDES Date with its ISO string",
    naive(withDate) === naive(withString)
  );
  check(
    "canonical hash distinguishes Date from ISO string",
    canonicalPipelineHash(withDate) !== canonicalPipelineHash(withString)
  );

  // (e) ObjectId + custom() stages hash fine; functions throw.
  const oid = new ObjectId("65f000000000000000000001");
  const customStages = rawEvents
    .aggregate()
    .custom<RawEvent>([
      { $match: { _ref: oid } },
      { $addFields: { flag: true } },
    ])
    .getPipeline();
  const hCustom = canonicalPipelineHash(customStages);
  check(
    "custom() stages (incl. ObjectId) hash deterministically",
    hCustom.startsWith("sha256:v1:")
  );

  const withFn = [
    {
      $match: {
        $where: function w() {
          return true;
        },
      },
    },
  ];
  let threw = false;
  try {
    canonicalPipelineHash(withFn);
  } catch {
    threw = true;
  }
  check("FINDING F5: canonical hash THROWS on function values", threw);
  // ...whereas naive JSON silently drops the key -> collision with {} match:
  check(
    "FINDING F5b: naive JSON silently drops functions (collision)",
    naive(withFn) === naive([{ $match: {} }])
  );

  // (f) Cross-process stability: spawn self with --child, compare digests.
  const self = process.argv[1] ?? "plan/spikes/pipeline-hash.spike.ts";
  const child = spawnSync("bun", ["run", "tsx", self, "--child"], {
    encoding: "utf8",
  });
  const parentHash = canonicalPipelineHash(fixedFixtureStages());
  console.log("parent:", parentHash);
  console.log("child :", child.stdout);
  check(
    "hash identical across separate OS processes",
    child.status === 0 && child.stdout === parentHash
  );

  console.log(
    "\n== 4. state:modified simulation over two manifest snapshots =="
  );

  type ManifestNode = {
    pipelineHash: string;
    configHash: string;
    deps: string[];
    lookupDeps: string[];
  };
  type MiniManifest = {
    models: Record<string, ManifestNode>;
    childMap: Record<string, string[]>;
  };

  const snapshot = (
    models: Model<string, Document, Document, never>[]
  ): MiniManifest => {
    const nodes: Record<string, ManifestNode> = {};
    const childMap: Record<string, string[]> = {};
    for (const m of models) {
      const upstream = m.getUpstreamModel();
      const lookupDeps = m
        .getAncestorsFromStages()
        .filter(isModel)
        .map((a) => a.name);
      // configHash over the UNRESOLVED materialize config: drop env db (F3).
      const { db: _db, ...unresolved } = m.materialize as { db?: string };
      nodes[m.name] = {
        pipelineHash: canonicalPipelineHash(m.getPipelineStages()),
        configHash: createHash("sha256")
          .update(canonicalJson(unresolved))
          .digest("hex"),
        deps: upstream ? [upstream.name] : [],
        lookupDeps,
      };
      for (const parent of [
        ...(upstream ? [upstream.name] : []),
        ...lookupDeps,
      ]) {
        (childMap[parent] ??= []).push(m.name);
      }
    }
    return { models: nodes, childMap };
  };

  const allModels = (stg: typeof stgEvents) => {
    const dm = new Model({
      name: "daily_metrics",
      from: stg,
      pipeline: (p) =>
        p
          .lookup({
            from: userDim,
            localField: "userId",
            foreignField: "_id",
            as: "user",
          })
          .group({ _id: "$day", total: { $count: {} } }),
      materialize: { type: "collection", mode: Model.Mode.Replace },
    });
    return [stg, userDim, dm] as unknown as Model<
      string,
      Document,
      Document,
      never
    >[];
  };

  const manifestV1 = snapshot(allModels(stgEvents));
  const manifestV2 = snapshot(allModels(makeStgEvents(6))); // semantic edit

  const modified = Object.keys(manifestV2.models).filter((name) => {
    const prev = manifestV1.models[name];
    const cur = manifestV2.models[name];
    if (!prev || !cur) return true; // added
    return (
      prev.pipelineHash !== cur.pipelineHash ||
      prev.configHash !== cur.configHash
    );
  });
  console.log("state:modified =", modified);
  check(
    "state:modified detects exactly the edited model",
    modified.length === 1 && modified[0] === "stg_events"
  );

  const expand = (
    seed: string[],
    childMap: Record<string, string[]>
  ): Set<string> => {
    const out = new Set(seed);
    const walk = (n: string) => {
      for (const c of childMap[n] ?? []) if (!out.has(c)) (out.add(c), walk(c));
    };
    seed.forEach(walk);
    return out;
  };
  const selected = expand(modified, manifestV2.childMap);
  console.log("state:modified+ =", [...selected]);
  check(
    "state:modified+ expands to descendants (incl. via lookup edges)",
    selected.has("stg_events") &&
      selected.has("daily_metrics") &&
      !selected.has("user_dim")
  );
  check(
    "lookup dep recorded in manifest node",
    (manifestV2.models["daily_metrics"]?.lookupDeps ?? []).includes("user_dim")
  );

  console.log("\n== 5. retry-failed selection from a run-results doc ==");
  const runResults = {
    results: [
      { model: "stg_events", status: "success" as const },
      { model: "user_dim", status: "error" as const },
      {
        model: "daily_metrics",
        status: "partialSuccess" as const,
        batches: [
          {
            start: "2026-01-01",
            end: "2026-01-02",
            status: "success" as const,
          },
          { start: "2026-01-02", end: "2026-01-03", status: "error" as const },
        ],
      },
    ],
  };
  const RETRYABLE = new Set(["error", "skipped", "partialSuccess"]);
  const retrySelect = runResults.results
    .filter((r) => RETRYABLE.has(r.status))
    .map((r) => r.model);
  const retryWindows = runResults.results
    .filter((r) => r.status === "partialSuccess")
    .map((r) => ({
      model: r.model,
      windows: (r.batches ?? []).filter((b) => b.status === "error"),
    }));
  console.log(
    "retry select =",
    retrySelect,
    "windows =",
    JSON.stringify(retryWindows)
  );
  check(
    "retry selects error + partialSuccess models only",
    retrySelect.length === 2 && !retrySelect.includes("stg_events")
  );
  check(
    "retry re-runs only failed microbatch windows",
    retryWindows[0]?.windows.length === 1
  );

  console.log(`\n${String(checks - failures)}/${String(checks)} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

void main();
