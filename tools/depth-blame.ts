#!/usr/bin/env bun
/**
 * depth-blame — diagnose TS2589 pressure for one named declaration. Traces only
 * the declaring file through the depth-stats-patched tsc, then reports the
 * declaration's own diagnostics, its per-call depth/count/tail stats against
 * the three ceilings, and the types instantiated where a ceiling was hit.
 * Survives an active TS2589 because the trace is flushed before the bail-out.
 *
 * See docs/typescript-depth/fix-guide.md for the full workflow.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

import {
  DEPTH_STEP_EVENT,
  materializePatchedTsc,
} from "./depth-viewer/patch-tsc";
import { TS2589_CEILINGS } from "./depth-viewer/src/types";
import {
  describeCall,
  indexDepthSteps,
  ownDepth,
  parseJsonArray,
  REPO_ROOT,
  runTscTrace,
  type DepthRecord,
  type RawDepthStep,
  type RawTypeEntry,
} from "./depth-viewer/trace";

const CACHE_DIR = resolve(REPO_ROOT, "tools/depth-viewer/.cache");
const TRACE_DIR = join(CACHE_DIR, "depth-blame-trace");
const SCOPED_TSCONFIG = join(CACHE_DIR, "depth-blame.tsconfig.json");
// Source-resolved configs first: configs with project `references` resolve the
// workspace packages to dist/, which loses source attribution.
const PREFERRED_TSCONFIGS = [
  "tools/depth-viewer/tsconfig.coverage.json",
  "tools/depth-viewer/tsconfig.stress.json",
].map((p) => resolve(REPO_ROOT, p));
// Trace paths are lowercased on case-insensitive filesystems.
const OWNED_PREFIXES = ["packages/core/src/", "packages/manifold/src/"].map(
  (p) => (resolve(REPO_ROOT, p) + "/").toLowerCase()
);
const {
  instantiationDepth: DEPTH_CEILING,
  instantiationCount: COUNT_CEILING,
  tailCount: TAIL_CEILING,
} = TS2589_CEILINGS;

interface TraceEvent {
  name?: string;
  args?: Record<string, unknown>;
}

interface Step {
  rec: DepthRecord;
  line: number;
  label: string;
}

function usage(code: number): never {
  console.log(`Usage:
  bun run depth-blame <name> <filePath>

Examples:
  bun run depth-blame depthStressPipeline tools/depth-viewer/fixtures/stress-pipelines.ts
  bun run depth-blame salesByCategoryPipeline packages/core/examples/ecommerce-analytics.ts

Traces <filePath> with the depth-stats-patched tsc and reports, for the
declaration named <name>: its diagnostics, which TS2589 ceiling each call
reached, and the types being instantiated when a ceiling was hit.`);
  process.exit(code);
}

const [name, fileArg] = process.argv.slice(2);
if (name === "--help" || name === "-h") usage(0);
if (!name || !fileArg) usage(1);

const targetFile = resolve(REPO_ROOT, fileArg);
if (!existsSync(targetFile)) {
  console.error(`File not found: ${targetFile}`);
  process.exit(2);
}

const fmt = (n: number) => n.toLocaleString();
const short = (p: string) => relative(REPO_ROOT, p);
const isOwned = (p: string) =>
  OWNED_PREFIXES.some((o) => p.toLowerCase().startsWith(o));

function includesFile(tsconfig: string, file: string): boolean {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  );
  return parsed?.fileNames.some((f) => resolve(f) === file) ?? false;
}

function findTsconfig(file: string): string {
  const candidates = [...PREFERRED_TSCONFIGS];
  for (let dir = dirname(file); dir.startsWith(REPO_ROOT); dir = dirname(dir)) {
    candidates.push(join(dir, "tsconfig.json"));
  }
  const found = candidates.find((c) => existsSync(c) && includesFile(c, file));
  if (!found) {
    console.error(`No tsconfig includes ${short(file)}.`);
    process.exit(2);
  }
  return found;
}

function findDeclaration(sf: ts.SourceFile): ts.Node | undefined {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (
      (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      return node;
    }
    return ts.forEachChild(node, visit);
  };
  return visit(sf);
}

function callsByEnd(
  decl: ts.Node,
  sf: ts.SourceFile
): Map<number, Omit<Step, "rec">> {
  const out = new Map<number, Omit<Step, "rec">>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      out.set(node.end, describeCall(node, sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(decl);
  return out;
}

const sf = ts.createSourceFile(
  targetFile,
  readFileSync(targetFile, "utf8"),
  ts.ScriptTarget.Latest,
  true
);
const decl = findDeclaration(sf);
if (!decl) {
  console.error(
    `No const or function named '${name}' in ${short(targetFile)}.`
  );
  process.exit(2);
}
const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const startLine = lineOf(decl.getStart(sf));
const endLine = lineOf(decl.end);

// --- trace --------------------------------------------------------------------

const tsconfig = findTsconfig(targetFile);
const { path: patchedTsc } = materializePatchedTsc({ repoRoot: REPO_ROOT });
writeFileSync(
  SCOPED_TSCONFIG,
  JSON.stringify({ extends: tsconfig, include: [], files: [targetFile] })
);
console.log(`Tracing ${short(targetFile)} via ${short(tsconfig)}...`);
const result = runTscTrace(
  process.execPath,
  [patchedTsc],
  SCOPED_TSCONFIG,
  TRACE_DIR
);
if (!existsSync(join(TRACE_DIR, "types.json"))) {
  console.error(`tsc failed before writing the trace (exit=${result.status}).`);
  console.error(result.stderr || result.stdout);
  process.exit(3);
}

// --- diagnostics ----------------------------------------------------------------

// A head line plus its indented elaboration lines (which carry PipeSafeError
// brand messages).
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error TS\d+: /;
const diagnostics = new Set<string>();
let current: string | undefined;
for (const l of result.stdout.split("\n")) {
  const m = DIAGNOSTIC.exec(l);
  if (m) {
    const line = Number(m[2]);
    current =
      (
        resolve(REPO_ROOT, m[1]!) === targetFile &&
        line >= startLine &&
        line <= endLine
      ) ?
        l
      : undefined;
    if (current) diagnostics.add(current);
  } else if (current && l.startsWith("  ")) {
    diagnostics.delete(current);
    current = `${current}\n${l}`;
    diagnostics.add(current);
  } else {
    current = undefined;
  }
}

// --- per-call stats -------------------------------------------------------------

const events = parseJsonArray<TraceEvent>(join(TRACE_DIR, "trace.json"));
const targetLower = targetFile.toLowerCase();
const prefix = `${targetLower}::`;
const sites = callsByEnd(decl, sf);
const steps: Step[] = [];
const depthIndex = indexDepthSteps(
  events.flatMap((e) =>
    e.name === DEPTH_STEP_EVENT ? [e.args as unknown as RawDepthStep] : []
  )
);
for (const [key, rec] of depthIndex) {
  const site = key.startsWith(prefix) ? sites.get(rec.end) : undefined;
  if (site) steps.push({ ...site, rec });
}
steps.sort((a, b) => a.rec.end - b.rec.end);

const peak = (f: (r: DepthRecord) => number) =>
  Math.max(0, ...steps.map((s) => f(s.rec)));
const ceilings = [
  ["instantiationDepth", (r: DepthRecord) => r.spanPeakDepth, DEPTH_CEILING],
  ["instantiationCount", (r: DepthRecord) => r.spanPeakCount, COUNT_CEILING],
  ["tailCount", (r: DepthRecord) => r.spanPeakTail, TAIL_CEILING],
] as const;

// --- types at the ceiling -------------------------------------------------------

// The patch tags each bail event with the node being checked.
const inDecl = (a: Record<string, unknown> | undefined) =>
  typeof a?.["path"] === "string" &&
  a["path"].toLowerCase() === targetLower &&
  (a["pos"] as number) >= decl.pos &&
  (a["end"] as number) <= decl.end;

const typeById = new Map(
  parseJsonArray<RawTypeEntry>(join(TRACE_DIR, "types.json")).map((t) => [
    t.id,
    t,
  ])
);
function named(id: number): RawTypeEntry | undefined {
  let t = typeById.get(id);
  while (t && !t.symbolName && t.instantiatedType !== undefined) {
    if (t.instantiatedType === t.id) return t;
    t = typeById.get(t.instantiatedType);
  }
  return t;
}
const limitHits = new Map<string, number>();
let unownedHits = 0;
for (const e of events) {
  if (e.name !== "instantiateType_DepthLimit" || !inDecl(e.args)) continue;
  const t = named(e.args?.["typeId"] as number);
  const at = t?.firstDeclaration;
  if (!at || !isOwned(at.path)) {
    unownedHits++;
    continue;
  }
  const key = `${t.symbolName}  ${short(at.path)}:${at.start.line}`;
  limitHits.set(key, (limitHits.get(key) ?? 0) + 1);
}

// --- report ---------------------------------------------------------------------

const rule = "─".repeat(78);
const row = (s: Step) =>
  `  line ${String(s.line).padEnd(6)} ${s.label.padEnd(22)} ` +
  `depth ${s.rec.spanPeakDepth} (+${ownDepth(s.rec)})  tail ${s.rec.spanPeakTail}  ` +
  `count ${fmt(s.rec.selfCount)} self / ${fmt(s.rec.spanPeakCount)} peak`;

console.log(rule);
console.log(
  `depth-blame  ·  ${name}  ·  ${short(targetFile)}:${startLine}-${endLine}`
);
console.log(rule);
console.log(
  diagnostics.size ?
    [...diagnostics].join("\n").replace(/^/gm, "  ")
  : "  No errors in the declaration."
);
console.log("");

if (steps.length === 0) {
  console.log("  No call expressions with trace records in the declaration.");
} else {
  console.log("Ceilings (peak over the declaration's calls):");
  for (const [label, f, cap] of ceilings) {
    const hit = steps.find((s) => f(s.rec) >= cap);
    console.log(
      `  ${label.padEnd(19)} ${fmt(peak(f)).padStart(10)} / ${fmt(cap)}` +
        (hit ? `  TRIPPED at line ${hit.line} ${hit.label}` : "")
    );
  }
  console.log("");
  const top = (title: string, f: (r: DepthRecord) => number) => {
    console.log(title);
    for (const s of [...steps]
      .sort((a, b) => f(b.rec) - f(a.rec))
      .slice(0, 5)) {
      console.log(row(s));
    }
    console.log("");
  };
  top("Calls by own instantiations:", (r) => r.selfCount);
  top("Calls by own depth:", ownDepth);
}

if (limitHits.size > 0) {
  console.log("PipeSafe types instantiated at a ceiling:");
  for (const [key, n] of [...limitHits]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`  ${String(n).padStart(6)}×  ${key}`);
  }
  console.log("");
}
if (unownedHits > 0) {
  console.log(`${fmt(unownedHits)} ceiling hits on types outside PipeSafe.\n`);
}

console.log(
  `Trace: ${short(TRACE_DIR)}/  ·  Decision tree: docs/typescript-depth/fix-guide.md §3`
);
