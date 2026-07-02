/**
 * SPIKE: Manifest & run-results state artifacts for @pipesafe/manifold
 *
 * Purpose:   Concretize plan/04-transform-roadmap.md §4 — the schemas for
 *            `.manifold/manifest.json` and `.manifold/run-results.json`
 *            (adapting dbt's manifest v12 / run_results v5 design), the
 *            canonical pipeline hash that replaces dbt's raw-text same_body
 *            comparison, and the selection algorithms they enable:
 *            state:modified, defer, and retry-from-failure.
 * Status:    ILLUSTRATIVE, NOT BUILT. Nothing here is imported by the packages;
 *            function bodies are sketches, not production code.
 * Build:     Excluded from all builds — plan/ is outside every tsconfig
 *            `include` and outside packages/*. Dependency-free by design
 *            (all referenced types are stubbed inline below).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

// ============================================================================
// Inline stubs (NOT the real @pipesafe types)
// ============================================================================

type Document = Record<string, any>;

interface ModelStub {
  readonly name: string;
  buildPipeline(): Document[]; // stages incl. terminal $out/$merge
  getOutputCollectionName(): string;
  getOutputDatabase(): string | undefined;
  /** from-edge + lookup/unionWith edges — assumes roadmap §2 fix is in. */
  getAllDependencyNames(): { from: string[]; lookup: string[] };
}

// ============================================================================
// 1. manifest.json — the serialized graph (dbt manifest analog)
// ============================================================================

/** Design rules copied from dbt (roadmap §4):
 *  - artifact schema is versioned INDEPENDENTLY of runtime classes, with
 *    explicit upgrade shims per version bump;
 *  - configs are stored UNRESOLVED (dbt's unrendered_config): no environment-
 *    specific database names baked in, so prod-vs-CI diffs stay clean;
 *  - parentMap/childMap are precomputed so consumers (CI, orchestrators,
 *    docs) never re-derive the graph.
 */
interface ManifoldManifest {
  schemaVersion: 1;
  metadata: {
    manifoldVersion: string;
    coreVersion: string;
    generatedAt: string; // ISO-8601
    invocationId: string;
    projectName: string;
  };
  models: Record<string, ManifestModelNode>;
  tests: Record<string, ManifestTestNode>;
  /** modelName -> upstream model names (from + lookup edges, deduped) */
  parentMap: Record<string, string[]>;
  /** modelName -> downstream model names */
  childMap: Record<string, string[]>;
}

interface ManifestModelNode {
  name: string;
  /** Canonical hash of the built stage array — see canonicalPipelineHash(). */
  pipelineHash: string;
  /** Hash of the UNRESOLVED materialize config (mode, on-keys, timeseries…),
   *  excluding env-resolved db names. Split from pipelineHash so
   *  state:modified.configs can be offered separately, like dbt's. */
  configHash: string;
  /** Unresolved materialization summary for display / defer resolution. */
  materialize:
    | { type: "view" }
    | {
        type: "collection";
        mode: "replace" | "merge" | "incremental" | "microbatch" | "snapshot";
      };
  /** Where the model writes. db is null when it follows the project default —
   *  the RESOLVED name is attached per-environment at defer time, not stored. */
  output: { db: string | null; collection: string };
  deps: string[]; // from-edge upstreams (models only)
  lookupDeps: string[]; // lookup/unionWith upstreams (models only)
  sourceCollections: string[]; // non-model roots, for freshness (doc 05)
  tags: string[];
  /** P3: static field-level lineage (Fusion CllEdge analog). */
  fieldLineage?: {
    fromNode: string;
    fromField: string;
    toField: string;
    op: string;
  }[];
}

interface ManifestTestNode {
  name: string; // e.g. "unique_stg_events_eventId"
  attachedTo: string; // model name
  kind:
    | "unique"
    | "notNull"
    | "acceptedValues"
    | "relationships"
    | "custom"
    | "unit";
  severity: "warn" | "error";
  pipelineHash: string;
}

// ============================================================================
// 2. run-results.json — per-invocation outcomes (dbt run_results analog)
// ============================================================================

interface ManifoldRunResults {
  schemaVersion: 1;
  metadata: {
    invocationId: string;
    generatedAt: string;
    manifoldVersion: string;
  };
  /** Full invocation options, verbatim — so `manifold retry` is self-contained
   *  (dbt stores args in run_results for exactly this reason). */
  invocationOptions: {
    select?: string[];
    exclude?: string[];
    fullRefresh?: boolean;
    eventTimeStart?: string;
    eventTimeEnd?: string;
    defer?: boolean;
    stateDir?: string;
  };
  results: ModelRunResult[];
}

interface ModelRunResult {
  model: string;
  status: "success" | "error" | "skipped" | "partialSuccess";
  startedAt: string;
  executionTimeMs: number;
  /** From the driver / $merge semantics where obtainable. */
  mergeStats?: { docsExamined?: number; docsWritten?: number };
  error?: { message: string; stack?: string };
  /** Microbatch only: per-window outcomes. status "partialSuccess" iff some
   *  batches failed — retry re-runs ONLY these windows (dbt PartialSuccess). */
  batches?: { start: string; end: string; status: "success" | "error" }[];
  testResults?: {
    test: string;
    status: "pass" | "warn" | "fail";
    failures: number;
  }[];
}

// ============================================================================
// 3. Canonical pipeline hash — semantic comparison, beating dbt's same_body
// ============================================================================

/**
 * dbt compares models by raw source text (same_body) — whitespace/comment
 * changes read as modifications; Fusion needed a full SQL frontend to fix it.
 * Manifold pipelines are already structured objects, so a canonical-JSON hash
 * of the built stage array is a SEMANTIC comparison for free:
 *  - object keys sorted recursively (stage payload key order is irrelevant);
 *  - Dates/ObjectIds/RegExps serialized via tagged canonical forms;
 *  - runtime-resolved values (watermarks, batch windows) are NOT baked in —
 *    the hash covers the pipeline SHAPE with placeholders, so an incremental
 *    model's hash is stable across runs;
 *  - env-resolved db names in $out/$merge targets replaced by the unresolved
 *    { db: null } form before hashing (the unrendered_config rule again).
 */
function canonicalPipelineHash(stages: Document[]): string {
  const canonicalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v instanceof Date) return { $date: v.toISOString() };
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, canonicalize((v as Document)[k])])
      );
    }
    return v;
  };
  const json = JSON.stringify(canonicalize(stages));
  return "sha256:" + sha256(json);
}
declare function sha256(input: string): string; // stub

// ============================================================================
// 4. state:modified selection (dbt StateSelectorMethod analog)
// ============================================================================

type ModifiedKind = "body" | "configs" | "added";

/** Diff current graph against a prior manifest (e.g. nightly prod artifact). */
function selectStateModified(
  current: ManifoldManifest,
  previous: ManifoldManifest
): Map<string, ModifiedKind> {
  const modified = new Map<string, ModifiedKind>();
  for (const [name, node] of Object.entries(current.models)) {
    const old = previous.models[name];
    if (!old) modified.set(name, "added");
    else if (node.pipelineHash !== old.pipelineHash) modified.set(name, "body");
    else if (node.configHash !== old.configHash) modified.set(name, "configs");
    // NOTE: no macro-diff pass needed — dbt walks depends_on.macros because
    // Jinja helpers change output invisibly; manifold "macros" are ordinary
    // TS functions whose effect is already IN the built stage array/hash.
  }
  return modified;
}

/** `state:modified+` = modified nodes plus all descendants via childMap. */
function expandDescendants(
  seed: Set<string>,
  m: ManifoldManifest
): Set<string> {
  const out = new Set(seed);
  const walk = (n: string) => {
    for (const child of m.childMap[n] ?? []) {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    }
  };
  for (const n of seed) walk(n);
  return out;
}

// ============================================================================
// 5. Defer — read unselected upstreams from the prod namespace
// ============================================================================

/**
 * dbt's merge_from_artifact, adapted: for every model NOT selected in this
 * run, remap reads of its output (as a `from` source or lookup target) to the
 * namespace recorded in the deferred (prod) manifest + a prod env binding.
 * Because pipelines are built lazily from structured config, this is a
 * source-resolution override, not string surgery on SQL.
 */
interface DeferBinding {
  db: string;
  collection: string;
}

function resolveDeferBindings(
  selected: Set<string>,
  prodManifest: ManifoldManifest,
  prodEnv: { defaultDatabase: string }
): Map<string, DeferBinding> {
  const bindings = new Map<string, DeferBinding>();
  for (const [name, node] of Object.entries(prodManifest.models)) {
    if (selected.has(name)) continue; // being rebuilt here; read locally
    bindings.set(name, {
      db: node.output.db ?? prodEnv.defaultDatabase, // resolve NOW, per env
      collection: node.output.collection,
    });
  }
  return bindings;
}

// ============================================================================
// 6. Retry-from-failure (dbt retry analog; executor mechanics in doc 05)
// ============================================================================

function computeRetrySelection(prev: ManifoldRunResults): {
  select: string[];
  batchWindows: Map<string, { start: string; end: string }[]>;
} {
  const RETRYABLE = new Set(["error", "skipped", "partialSuccess"]);
  const select: string[] = [];
  const batchWindows = new Map<string, { start: string; end: string }[]>();
  for (const r of prev.results) {
    if (!RETRYABLE.has(r.status)) continue;
    select.push(r.model);
    if (r.status === "partialSuccess" && r.batches) {
      batchWindows.set(
        r.model,
        r.batches
          .filter((b) => b.status === "error")
          .map(({ start, end }) => ({ start, end }))
      );
    }
  }
  // Re-run with prev.invocationOptions + { select } — no external memory needed.
  return { select, batchWindows };
}

// ============================================================================
// 7. Composed: the slim-CI recipe these artifacts unlock
// ============================================================================
//
//   1. Nightly prod run writes .manifold/{manifest,run-results}.json to storage.
//   2. PR CI:  manifold build --select state:modified+ --defer --state ./prod-artifacts
//      -> selectStateModified + expandDescendants pick the work;
//      -> resolveDeferBindings reads unchanged upstreams from prod;
//      -> only changed models and descendants materialize, into a CI database.
//   3. On failure: manifold retry  -> computeRetrySelection re-runs only
//      failed/skipped models (and only failed microbatch windows).

export type {
  ManifoldManifest,
  ManifestModelNode,
  ManifoldRunResults,
  ModelRunResult,
};
export {
  canonicalPipelineHash,
  selectStateModified,
  expandDescendants,
  resolveDeferBindings,
  computeRetrySelection,
};
