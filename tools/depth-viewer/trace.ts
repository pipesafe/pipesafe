import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { DEPTH_STEP_EVENT } from "./patch-tsc";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function findTscBin(): string {
  const local = resolve(REPO_ROOT, "node_modules/.bin/tsc");
  if (!existsSync(local)) {
    console.error(`Local tsc not found at ${local}. Run 'bun install'.`);
    process.exit(2);
  }
  return local;
}

/**
 * Run `tsc --generateTrace` into a freshly emptied `traceDir`. Incrementality
 * is disabled so a composite project's tsbuildinfo can neither short-circuit
 * the check (empty trace) nor be rewritten.
 */
export function runTscTrace(
  command: string,
  baseArgs: string[],
  tsconfigPath: string,
  traceDir: string
): SpawnSyncReturns<string> {
  rmSync(traceDir, { recursive: true, force: true });
  mkdirSync(traceDir, { recursive: true });
  return spawnSync(
    command,
    [
      ...baseArgs,
      "-p",
      tsconfigPath,
      "--noEmit",
      "--generateTrace",
      traceDir,
      "--extendedDiagnostics",
      "--composite",
      "false",
      "--incremental",
      "false",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 }
  );
}

/** Parse a tsc trace JSON array, tolerating a truncated trailing line. */
export function parseJsonArray<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as T[];
  } catch {
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim().replace(/,$/, "");
      if (!t || t === "[" || t === "]") continue;
      try {
        out.push(JSON.parse(t) as T);
      } catch {
        // tsc occasionally truncates the trailing line; ignore.
      }
    }
    return out;
  }
}

/** A types.json registry entry (the fields these tools read). */
export interface RawTypeEntry {
  id: number;
  symbolName?: string;
  intrinsicName?: string;
  display?: string;
  flags?: string[];
  recursionId?: number;
  instantiatedType?: number;
  typeArguments?: number[];
  firstDeclaration?: {
    path: string;
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

// A `depthStep` instant event emitted by the depth-stats-patched tsc (see
// patch-tsc.ts). One per Call/New expression that did instantiation work,
// carrying the node's source range plus deterministic depth/count stats. The
// outer `ph`/`name`/`ts` envelope is dropped; only `args` matters here.
export interface RawDepthStep {
  /** SyntaxKind: 214 = CallExpression, 215 = NewExpression. */
  kind: number;
  /** Node full-width start/end (matches the Compiler API's node.pos/node.end). */
  pos: number;
  end: number;
  /** Absolute source path (lowercased on case-insensitive filesystems). */
  path?: string;
  /** instantiationDepth on entry to this node's check (the ambient depth). */
  enterDepth: number;
  /** Peak instantiationDepth over this node's whole subtree (climbs to 100 = TS2589). */
  spanPeakDepth: number;
  /** Peak depth excluding nested Call/New children — the depth this node added. */
  selfPeakDepth: number;
  /** Peak tailCount over this node's subtree (climbs to 1000 = TS2589). */
  spanPeakTail: number;
  /** Peak tailCount in windows where this node is the innermost expression. */
  selfPeakTail: number;
  /**
   * Instantiations performed while this node is the innermost expression — the
   * marginal work it does, NOT inherited by later steps that contain it. A
   * single step crossing 5,000,000 is what collapses the type to `any` (TS2589).
   */
  selfCount: number;
  /**
   * Peak of the checker's own `instantiationCount` over this node's subtree —
   * the value TS compares against 5,000,000.
   */
  spanPeakCount: number;
  /** Monotonic totalInstantiationCount bracketing this node's subtree. */
  enterTotalCount: number;
  exitTotalCount: number;
}

/** Aggregated per-node depth stats, keyed by `${path.toLowerCase()}::${end}`. */
export interface DepthRecord {
  kind: number;
  pos: number;
  end: number;
  enterDepth: number;
  spanPeakDepth: number;
  selfPeakDepth: number;
  spanPeakTail: number;
  selfPeakTail: number;
  selfCount: number;
  spanPeakCount: number;
  enterTotalCount: number;
  exitTotalCount: number;
}

// Per-node depth records keyed by `${absolutePathLowercased}::${node.end}`.
// `node.end` is unique per Call/New node within a file (chain steps share a
// start but their ends strictly increase), so it's a stable join key against
// the AST. Lowercasing both sides absorbs tsc's macOS path-casing.
export type DepthIndex = Map<string, DepthRecord>;

export function depthKey(absPathLower: string, end: number): string {
  return `${absPathLower}::${end}`;
}

// Aggregate raw `depthStep` payloads into the per-node index. checkExpression
// runs a node more than once (contextual typing, overload resolution, re-checks)
// and the patch emits a depthStep on every pass, so each (path,end) can have
// several records. The canonical one is the deepest pass (max spanPeakDepth),
// tie-broken by the largest subtree (max exitTotalCount) — both criteria are
// total orders over the data, so the choice is deterministic. All fields of the
// chosen record come from that single pass, so enter/exitTotalCount stay a
// coherent pair (no cross-pass mixing).
export function indexDepthSteps(records: RawDepthStep[]): DepthIndex {
  const index: DepthIndex = new Map();
  for (const a of records) {
    if (a.path === undefined || a.end === undefined) continue;
    const key = depthKey(a.path.toLowerCase(), a.end);
    const prev = index.get(key);
    if (
      !prev ||
      a.spanPeakDepth > prev.spanPeakDepth ||
      (a.spanPeakDepth === prev.spanPeakDepth &&
        a.exitTotalCount > prev.exitTotalCount)
    ) {
      index.set(key, {
        kind: a.kind,
        pos: a.pos,
        end: a.end,
        enterDepth: a.enterDepth,
        spanPeakDepth: a.spanPeakDepth,
        selfPeakDepth: a.selfPeakDepth,
        spanPeakTail: a.spanPeakTail,
        selfPeakTail: a.selfPeakTail,
        selfCount: a.selfCount,
        spanPeakCount: a.spanPeakCount,
        enterTotalCount: a.enterTotalCount,
        exitTotalCount: a.exitTotalCount,
      });
    }
  }
  return index;
}

// Read the patched tsc's `depthStep` instant events from a trace dir and index
// them. trace.json can be very large, so we scan line-by-line and only parse
// lines that mention the event — every other event (the sampled X spans, etc.)
// is irrelevant. tsc writes one event per line via writeEvent, and a depthStep's
// args are numbers + the file path, so the `"name":"depthStep"` needle can't
// appear inside another event's args.
export function parseDepthSteps(traceDir: string): DepthIndex {
  const path = join(traceDir, "trace.json");
  if (!existsSync(path)) return new Map();
  const raw = readFileSync(path, "utf8");
  const needle = `"name":"${DEPTH_STEP_EVENT}"`;
  const records: RawDepthStep[] = [];
  for (const line of raw.split("\n")) {
    if (!line.includes(needle)) continue;
    const trimmed = line.trim().replace(/,$/, "");
    try {
      const evt = JSON.parse(trimmed) as { args?: RawDepthStep };
      if (evt.args) records.push(evt.args);
    } catch {
      // tsc occasionally truncates the trailing line; ignore.
    }
  }
  return indexDepthSteps(records);
}
/** Depth a node's own resolution added above its entry depth. */
export function ownDepth(rec: DepthRecord): number {
  return Math.max(0, rec.selfPeakDepth - rec.enterDepth);
}

/**
 * Label a Call/New node and locate its invocation site: the member name of a
 * property-access call, the key of an element-access call, else the node's own
 * start. `getStart()` alone would report the chain root for every chained step.
 */
export function describeCall(
  call: ts.CallExpression | ts.NewExpression,
  sf: ts.SourceFile
): { label: string; member?: string; line: number } {
  const callee = call.expression;
  let site: ts.Node = call;
  let label: string;
  let member: string | undefined;
  if (ts.isNewExpression(call)) {
    label = `new ${callee.getText(sf)}(${call.typeArguments ? `<${call.typeArguments.map((a) => a.getText(sf)).join(", ")}>` : ""}…)`;
  } else if (ts.isPropertyAccessExpression(callee)) {
    site = callee.name;
    member = callee.name.text;
    label = `.${member}(…)`;
  } else {
    if (ts.isElementAccessExpression(callee)) site = callee.argumentExpression;
    label = callee.getText(sf).slice(0, 60) + "(…)";
  }
  const line = sf.getLineAndCharacterOfPosition(site.getStart(sf)).line + 1;
  return member ? { label, member, line } : { label, line };
}
