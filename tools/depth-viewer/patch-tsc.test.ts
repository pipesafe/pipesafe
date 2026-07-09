import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { indexDepthSteps } from "./build";
import {
  AnchorError,
  DEPTH_STEP_EVENT,
  EDIT_NAMES,
  MARKER,
  materializePatchedTsc,
  patchTscSource,
  resolveStockTsc,
} from "./patch-tsc";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

// A hermetic fixture (no repo-config inheritance). `build(10)` is a
// CallExpression whose return type is a recursive alias instantiated to depth
// ~10, and `new Holder(...)` is a NewExpression — so both kinds the patch emits
// `depthStep` for fire, with a real (sub-ceiling) peak depth. `lib: ["es2020"]`
// is required: without a lib the checker skips the interesting work.
const FIXTURE_TS = `
type Rec<T, N extends number, A extends unknown[] = []> =
  A["length"] extends N ? T : Rec<{ v: T }, N, [unknown, ...A]>;
declare function build<N extends number>(n: N): Rec<string, N>;
class Holder<T> { constructor(public value: T) {} }
const built = build(10);
const held = new Holder(built);
void built;
void held;
`;

const FIXTURE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    noEmit: true,
    strict: true,
    lib: ["es2020"],
    moduleDetection: "force",
    incremental: false,
    composite: false,
  },
  include: ["t.ts"],
});

interface TraceEvent {
  ph: string;
  cat?: string;
  name?: string;
  ts?: number;
  args?: Record<string, unknown>;
}

/** Run a compiler bundle under the current node, returning its trace events. */
function runTrace(bundlePath: string, projectPath: string): TraceEvent[] {
  const traceDir = mkdtempSync(join(tmpdir(), "patch-tsc-trace-"));
  try {
    spawnSync(
      process.execPath,
      [bundlePath, "-p", projectPath, "--noEmit", "--generateTrace", traceDir],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 }
    );
    // JSON.parse doubles as a well-formedness assertion on the emitted trace.
    return JSON.parse(
      readFileSync(join(traceDir, "trace.json"), "utf8")
    ) as TraceEvent[];
  } finally {
    rmSync(traceDir, { recursive: true, force: true });
  }
}

const NUMERIC_DEPTH_FIELDS = [
  "kind",
  "pos",
  "end",
  "enterDepth",
  "spanPeakDepth",
  "selfPeakDepth",
  "spanPeakTail",
  "selfPeakTail",
  "selfCount",
  "enterTotalCount",
  "exitTotalCount",
] as const;

const depthSteps = (events: TraceEvent[]): Record<string, unknown>[] =>
  events
    .filter((e) => e.name === DEPTH_STEP_EVENT && typeof e.args === "object")
    .map((e) => e.args as Record<string, unknown>);

describe("patchTscSource (unit)", () => {
  const stockSrc = readFileSync(resolveStockTsc(REPO_ROOT), "utf8");

  it("applies every edit exactly once against the real bundled _tsc.js", () => {
    const { matched, alreadyPatched, code } = patchTscSource(stockSrc);
    expect(alreadyPatched).toBe(false);
    expect(Object.keys(matched).sort()).toEqual([...EDIT_NAMES].sort());
    for (const name of EDIT_NAMES) expect(matched[name]).toBe(1);
    expect(code).toContain(MARKER);
    expect(code).not.toBe(stockSrc);
  });

  it("is idempotent — a patched source is returned unchanged", () => {
    const once = patchTscSource(stockSrc).code;
    const twice = patchTscSource(once);
    expect(twice.alreadyPatched).toBe(true);
    expect(twice.code).toBe(once);
    expect(twice.matched).toEqual({});
  });

  it("throws a named AnchorError when an anchor is missing", () => {
    let thrown: unknown;
    try {
      patchTscSource("function unrelated() { return 1; }");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AnchorError);
    expect((thrown as AnchorError).editName).toBe(EDIT_NAMES[0]);
    expect((thrown as AnchorError).count).toBe(0);
  });

  it("materializes a syntactically valid bundle (node --check passes)", () => {
    const { path } = materializePatchedTsc({ repoRoot: REPO_ROOT });
    const check = spawnSync(process.execPath, ["--check", path], {
      encoding: "utf8",
    });
    expect(check.status, check.stderr).toBe(0);
  });
});

describe("patched tsc trace (integration)", () => {
  let fixtureDir: string;
  let patchedPath: string;
  let stockPath: string;
  let patched: TraceEvent[];
  let stock: TraceEvent[];

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "patch-tsc-fixture-"));
    writeFileSync(join(fixtureDir, "t.ts"), FIXTURE_TS);
    writeFileSync(join(fixtureDir, "tsconfig.json"), FIXTURE_TSCONFIG);

    patchedPath = materializePatchedTsc({ repoRoot: REPO_ROOT }).path;
    stockPath = resolveStockTsc(REPO_ROOT);

    const project = join(fixtureDir, "tsconfig.json");
    patched = runTrace(patchedPath, project);
    stock = runTrace(stockPath, project);
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("emits depthStep instants for the fixture's Call/New expressions", () => {
    const steps = depthSteps(patched);
    expect(steps.length).toBeGreaterThan(0);
    // Only Call (214) and New (215) expressions are emitted.
    for (const s of steps) expect([214, 215]).toContain(s.kind);
    // Both kinds appear: build(10) is a call, new Holder(...) is a new.
    expect(steps.some((s) => s.kind === 214)).toBe(true);
    expect(steps.some((s) => s.kind === 215)).toBe(true);
  });

  it("every depthStep carries all numeric depth/tail/count fields", () => {
    const steps = depthSteps(patched);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      for (const f of NUMERIC_DEPTH_FIELDS) {
        expect(typeof s[f], `${f} on ${JSON.stringify(s)}`).toBe("number");
      }
      expect(typeof s.path).toBe("string");
    }
  });

  it("captures a real peak instantiation depth above the entry depth", () => {
    // build(10) instantiates a recursive alias to depth ~10 — proof the patch
    // records the mid-flight peak, not the balanced entry/exit value (which the
    // span's own counter always returns to).
    const steps = depthSteps(patched);
    const peak = Math.max(...steps.map((s) => Number(s.spanPeakDepth)));
    expect(peak).toBeGreaterThan(1);
    expect(
      steps.some((s) => Number(s.spanPeakDepth) > Number(s.enterDepth))
    ).toBe(true);
  });

  it("emits depthStep via the unsampled instant ('I') path", () => {
    // Instant events are written unconditionally — unlike the 10ms-sampled X
    // spans — so they must all be ph:'I'.
    const stepEvents = patched.filter((e) => e.name === DEPTH_STEP_EVENT);
    expect(stepEvents.length).toBeGreaterThan(0);
    for (const e of stepEvents) expect(e.ph).toBe("I");
  });

  it("stock tsc emits NO depthStep events (control)", () => {
    expect(depthSteps(stock)).toEqual([]);
  });

  it("is deterministic: depthStep payloads are byte-identical across runs", () => {
    const rerun = runTrace(patchedPath, join(fixtureDir, "tsconfig.json"));
    // ts is wall-clock; the args (source range + counters) must not vary.
    const norm = (events: TraceEvent[]): string =>
      JSON.stringify(
        depthSteps(events).sort(
          (a, b) =>
            Number(a.pos) - Number(b.pos) || Number(a.end) - Number(b.end)
        )
      );
    expect(depthSteps(patched).length).toBeGreaterThan(0);
    expect(norm(rerun)).toBe(norm(patched));
  });
});

describe("indexDepthSteps (dedup of re-checked nodes)", () => {
  // A node checked over several checkExpression passes emits one depthStep per
  // pass. The index must keep the deepest pass, and ALL its fields must come
  // from that same pass (no cross-pass mixing of enter/exitTotalCount).
  const base = {
    kind: 214,
    pos: 10,
    end: 42,
    path: "/Proj/Src/File.ts",
    enterDepth: 0,
    spanPeakDepth: 5,
    selfPeakDepth: 5,
    spanPeakTail: 0,
    selfPeakTail: 0,
    selfCount: 100,
    enterTotalCount: 0,
    exitTotalCount: 100,
  };
  const rec = (over: Partial<typeof base> = {}) => ({ ...base, ...over });

  it("keeps the max-spanPeakDepth pass for a given (path,end)", () => {
    const idx = indexDepthSteps([
      rec({ spanPeakDepth: 5, enterTotalCount: 0, exitTotalCount: 100 }),
      rec({
        spanPeakDepth: 40,
        enterTotalCount: 900,
        exitTotalCount: 1300,
        selfCount: 7,
      }),
      rec({ spanPeakDepth: 12, enterTotalCount: 5000, exitTotalCount: 9999 }),
    ]);
    expect(idx.size).toBe(1);
    const r = [...idx.values()][0]!;
    expect(r.spanPeakDepth).toBe(40);
    // enter/exit must be the chosen pass's pair, not min/max across passes.
    expect(r.enterTotalCount).toBe(900);
    expect(r.exitTotalCount).toBe(1300);
    expect(r.selfCount).toBe(7);
  });

  it("breaks spanPeakDepth ties by the larger exitTotalCount, deterministically", () => {
    const a = indexDepthSteps([
      rec({ spanPeakDepth: 100, exitTotalCount: 200 }),
      rec({ spanPeakDepth: 100, exitTotalCount: 5_000_000 }),
    ]);
    const b = indexDepthSteps([
      rec({ spanPeakDepth: 100, exitTotalCount: 5_000_000 }),
      rec({ spanPeakDepth: 100, exitTotalCount: 200 }),
    ]);
    // Order-independent: both pick exitTotalCount=5_000_000.
    expect([...a.values()][0]!.exitTotalCount).toBe(5_000_000);
    expect([...b.values()][0]!.exitTotalCount).toBe(5_000_000);
  });

  it("keys by (path,end) lowercased, so distinct nodes don't collide", () => {
    const idx = indexDepthSteps([
      rec({ end: 42, spanPeakDepth: 5 }),
      rec({ end: 99, spanPeakDepth: 9 }),
      rec({ path: "/proj/src/file.ts", end: 42, spanPeakDepth: 50 }), // same file, case-diff
    ]);
    expect(idx.size).toBe(2); // ends 42 and 99
    expect([...idx.values()].find((r) => r.end === 42)!.spanPeakDepth).toBe(50);
  });
});
