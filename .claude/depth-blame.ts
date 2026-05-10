#!/usr/bin/env bun
/**
 * depth-blame — diagnose TypeScript instantiation-depth pressure for a single
 * expression. Generates a tsc trace, parses it, and ranks PipeSafe-owned types
 * by self-time. Survives an active TS2589 because the trace is flushed before
 * the bail-out.
 *
 * See docs/typescript-depth/fix-guide.md for the full workflow.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TraceEvent {
  ph: string;
  cat?: string;
  name?: string;
  ts?: number;
  dur?: number;
  args?: Record<string, unknown>;
}

interface TypeEntry {
  id: number;
  symbolName?: string;
  recursionId?: number;
  flags?: string[];
  display?: string;
  intrinsicName?: string;
  instantiatedType?: number;
  typeArguments?: number[];
  firstDeclaration?: {
    path: string;
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface OffenderRow {
  symbolName: string;
  filePath: string;
  line: number;
  totalUs: number;
  callCount: number;
  owned: boolean;
}

interface DepthLimitHit {
  typeId: number;
  symbolName: string;
  filePath: string;
  line: number;
  instantiationDepth: number;
  instantiationCount: number;
  kind: "instantiate" | "relatedTo";
  owned: boolean;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dir, "..");
const PIPESAFE_OWNED_PREFIXES = [
  resolve(REPO_ROOT, "packages/core/src") + "/",
  resolve(REPO_ROOT, "packages/manifold/src") + "/",
];

function usage(code = 1): never {
  console.log(`Usage:
  bun run depth-blame <varName> [filePath]
  bun run depth-blame --view [traceDir]
  bun run depth-blame --help

Examples:
  bun run depth-blame ResolveSetOutputResult packages/core/src/stages/set.typeAssertions.ts
  bun run depth-blame OwnersPipeline packages/core/examples/user-management.ts
  bun run depth-blame --view /tmp/depth-blame-XXXX/trace

Generates a TypeScript --generateTrace, ranks PipeSafe-owned types by self-time,
and reports which TS2589 counter (if any) tripped.`);
  process.exit(code);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") usage(0);

if (args[0] === "--view") {
  const traceDir = args[1];
  openViewer(traceDir);
  process.exit(0);
}

const varName = args[0];
const userFile = args[1];

if (!varName) usage(1);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOwned(path: string): boolean {
  const abs = resolve(path);
  return PIPESAFE_OWNED_PREFIXES.some((p) => abs.startsWith(p));
}

function shortPath(path: string): string {
  const abs = resolve(path);
  return relative(REPO_ROOT, abs) || abs;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function findTscBin(): string {
  const local = resolve(REPO_ROOT, "node_modules/.bin/tsc");
  if (existsSync(local)) return local;
  console.error(`Could not find local tsc at ${local}. Run 'bun install' first.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// File / tsconfig resolution
// ---------------------------------------------------------------------------

function resolveTargetFile(): string {
  if (userFile) {
    const candidate = resolve(REPO_ROOT, userFile);
    if (!existsSync(candidate)) {
      console.error(`File not found: ${candidate}`);
      process.exit(2);
    }
    return candidate;
  }
  console.error(
    "filePath is required. Pass the file containing the symbol, e.g.\n" +
      "  bun run depth-blame MyVar packages/core/src/stages/match.typeAssertions.ts",
  );
  process.exit(2);
}

function findOwningTsconfig(file: string): string {
  // Walk up from the file looking for a tsconfig.json that includes the file
  // (or doesn't have an `include` and might catch it via globs).
  let dir = dirname(file);
  while (dir.length > 1 && dir.startsWith(REPO_ROOT)) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return resolve(REPO_ROOT, "tsconfig.json");
}

// ---------------------------------------------------------------------------
// Trace generation
// ---------------------------------------------------------------------------

function generateTrace(targetFile: string): {
  traceDir: string;
  stderr: string;
  stdout: string;
  workDir: string;
  exitCode: number | null;
  owningTsconfig: string;
} {
  const workDir = mkdtempSync(join(tmpdir(), "depth-blame-"));
  const traceDir = join(workDir, "trace");
  mkdirSync(traceDir, { recursive: true });

  const owningTsconfig = findOwningTsconfig(targetFile);

  // Use the owning tsconfig as-is and add --generateTrace via CLI.
  // This is more reliable than synthesising a derived tsconfig: type-checking
  // only fires when a Program is built that the file participates in, which
  // requires the include/references context the parent project provides.
  const tsc = findTscBin();
  // Clear the project's incremental cache before invoking tsc.
  //
  // Why: `composite: true` in the project tsconfig implies `incremental: true`,
  // which writes `tsconfig.tsbuildinfo` next to the config. The next run reads
  // that file as a cache hit and skips type-checking entirely — producing an
  // empty trace. Running depth-blame after a normal `bun run build` would
  // silently no-op without this.
  const buildInfoPath = join(dirname(owningTsconfig), "tsconfig.tsbuildinfo");
  if (existsSync(buildInfoPath)) {
    rmSync(buildInfoPath);
  }
  const result = spawnSync(
    tsc,
    [
      "-p",
      owningTsconfig,
      "--noEmit",
      "--generateTrace",
      traceDir,
      "--extendedDiagnostics",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 200 * 1024 * 1024,
    },
  );

  return {
    traceDir,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
    workDir,
    exitCode: result.status,
    owningTsconfig,
  };
}

// ---------------------------------------------------------------------------
// Trace parsing
// ---------------------------------------------------------------------------

function parseJsonArrayFile<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  // tsc writes a (sometimes incomplete) JSON array. Try strict parse first;
  // if it fails (e.g. truncated trailing entry), fall back to per-line parse.
  try {
    return JSON.parse(raw) as T[];
  } catch {
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim().replace(/,$/, "");
      if (!trimmed || trimmed === "[" || trimmed === "]") continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // ignore malformed lines (typically the very last one if truncated)
      }
    }
    return out;
  }
}

function loadTrace(traceDir: string): {
  events: TraceEvent[];
  types: TypeEntry[];
} {
  const tracePath = join(traceDir, "trace.json");
  const typesPath = join(traceDir, "types.json");
  if (!existsSync(tracePath) || !existsSync(typesPath)) {
    console.error(
      `Trace files missing in ${traceDir}. tsc may have failed before writing them.`,
    );
    process.exit(3);
  }
  return {
    events: parseJsonArrayFile<TraceEvent>(tracePath),
    types: parseJsonArrayFile<TypeEntry>(typesPath),
  };
}

// ---------------------------------------------------------------------------
// TS2589 detection
// ---------------------------------------------------------------------------

interface DepthDiagnosis {
  hadError: boolean;
  errorLines: string[];
  inferredCounter: "depth" | "count" | "tail" | "unknown" | null;
  instantiationCount?: number;
  totalInstantiations?: number;
  checkTimeMs?: number;
  depthLimitHits: number;
  relatedToLimitHits: number;
  peakInstantiationCount: number;
}

function diagnoseDepthErrors(
  stdout: string,
  stderr: string,
  events: TraceEvent[],
): DepthDiagnosis {
  const combined = stdout + "\n" + stderr;
  const errorLines = combined
    .split("\n")
    .filter(
      (l) =>
        l.includes("TS2589") ||
        l.toLowerCase().includes("excessively deep") ||
        l.toLowerCase().includes("possibly infinite"),
    );

  const out: DepthDiagnosis = {
    hadError: errorLines.length > 0,
    errorLines,
    inferredCounter: null,
    depthLimitHits: 0,
    relatedToLimitHits: 0,
    peakInstantiationCount: 0,
  };

  // Pull diagnostics totals if present (--extendedDiagnostics output is on stdout).
  const matchInst = stdout.match(/Instantiations:\s*([0-9,]+)/);
  if (matchInst?.[1]) out.totalInstantiations = Number(matchInst[1].replace(/,/g, ""));
  const matchCheck = stdout.match(/Check time:\s*([0-9.]+)\s*s/);
  if (matchCheck?.[1]) out.checkTimeMs = Number(matchCheck[1]) * 1000;

  // Trace-side: count *_DepthLimit events.
  for (const ev of events) {
    if (ev.name === "instantiateType_DepthLimit") {
      out.depthLimitHits += 1;
      const c = (ev.args?.["instantiationCount"] as number | undefined) ?? 0;
      if (c > out.peakInstantiationCount) out.peakInstantiationCount = c;
    } else if (ev.name === "recursiveTypeRelatedTo_DepthLimit") {
      out.relatedToLimitHits += 1;
    }
  }

  // Best-effort counter inference:
  //   - explicit TS2589 + many DepthLimit events ⇒ depth
  //   - explicit TS2589 + total near 5M ⇒ count
  //   - explicit TS2589 + neither ⇒ likely tail
  if (out.hadError) {
    if (
      out.totalInstantiations !== undefined &&
      out.totalInstantiations > 4_500_000
    ) {
      out.inferredCounter = "count";
    } else if (out.depthLimitHits > 0) {
      out.inferredCounter = "depth";
    } else {
      out.inferredCounter = "tail";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Type lookup
// ---------------------------------------------------------------------------

function resolveType(
  typeId: number,
  typeById: Map<number, TypeEntry>,
): TypeEntry | undefined {
  let cursor = typeById.get(typeId);
  let hops = 0;
  // Walk up the instantiatedType chain until we hit a type with a symbolName.
  while (cursor && !cursor.symbolName && hops < 8) {
    if (cursor.instantiatedType !== undefined) {
      cursor = typeById.get(cursor.instantiatedType);
    } else {
      break;
    }
    hops += 1;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregateOffenders(
  events: TraceEvent[],
  types: TypeEntry[],
): OffenderRow[] {
  const typeById = new Map<number, TypeEntry>();
  for (const t of types) typeById.set(t.id, t);

  const buckets = new Map<string, OffenderRow>();

  for (const ev of events) {
    if (ev.ph !== "X" || !ev.dur || !ev.args) continue;
    if (ev.cat !== "checkTypes") continue;
    const args = ev.args;
    const idCandidate = args["typeId"] ?? args["sourceId"] ?? args["targetId"];
    const id = typeof idCandidate === "number" ? idCandidate : undefined;

    let symbolName: string | undefined;
    let path: string | undefined;
    let line = 0;

    if (id !== undefined) {
      const t = resolveType(id, typeById);
      if (t) {
        symbolName = t.symbolName ?? t.intrinsicName;
        if (t.firstDeclaration) {
          path = t.firstDeclaration.path;
          line = t.firstDeclaration.start.line;
        }
      }
    }

    if (!symbolName) {
      symbolName = (ev.name ?? "<anonymous>") + " (unattributed)";
    }
    const filePath = path ?? "<unknown>";
    const owned = path ? isOwned(path) : false;

    const key = `${symbolName}|${filePath}:${line}`;
    let row = buckets.get(key);
    if (!row) {
      row = { symbolName, filePath, line, totalUs: 0, callCount: 0, owned };
      buckets.set(key, row);
    }
    row.totalUs += ev.dur;
    row.callCount += 1;
  }

  return Array.from(buckets.values()).sort((a, b) => b.totalUs - a.totalUs);
}

function aggregateDepthLimitHits(
  events: TraceEvent[],
  types: TypeEntry[],
): DepthLimitHit[] {
  const typeById = new Map<number, TypeEntry>();
  for (const t of types) typeById.set(t.id, t);

  const out: DepthLimitHit[] = [];
  for (const ev of events) {
    if (
      ev.name !== "instantiateType_DepthLimit" &&
      ev.name !== "recursiveTypeRelatedTo_DepthLimit"
    ) {
      continue;
    }
    if (!ev.args) continue;
    const id =
      (ev.args["typeId"] as number | undefined) ??
      (ev.args["sourceId"] as number | undefined);
    if (id === undefined) continue;
    const t = resolveType(id, typeById);
    if (!t) continue;
    const path = t.firstDeclaration?.path ?? "<unknown>";
    out.push({
      typeId: id,
      symbolName: t.symbolName ?? t.intrinsicName ?? `Type#${id}`,
      filePath: path,
      line: t.firstDeclaration?.start.line ?? 0,
      instantiationDepth: (ev.args["instantiationDepth"] as number) ?? 0,
      instantiationCount: (ev.args["instantiationCount"] as number) ?? 0,
      kind:
        ev.name === "instantiateType_DepthLimit" ? "instantiate" : "relatedTo",
      owned: path ? isOwned(path) : false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function findVarOccurrence(
  targetFile: string,
  variable: string,
): { line: number; col: number } | null {
  try {
    const src = readFileSync(targetFile, "utf8");
    const lines = src.split("\n");
    const re = new RegExp(`\\b${variable}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = re.exec(line);
      if (m) return { line: i + 1, col: m.index + 1 };
    }
  } catch {
    // ignore
  }
  return null;
}

function printReport(
  targetFile: string,
  diag: DepthDiagnosis,
  offenders: OffenderRow[],
  hits: DepthLimitHit[],
  traceDir: string,
  owningTsconfig: string,
): void {
  const ownedTop = offenders.filter((o) => o.owned).slice(0, 15);
  const allTop = offenders.slice(0, 10);

  const banner = "─".repeat(78);
  console.log(banner);
  console.log(`depth-blame  ·  ${shortPath(targetFile)}  ·  ${varName}`);
  console.log(banner);
  console.log(`  tsconfig: ${shortPath(owningTsconfig)}`);

  const occ = findVarOccurrence(targetFile, varName);
  if (occ) {
    console.log(`  Symbol located at ${shortPath(targetFile)}:${occ.line}:${occ.col}`);
  } else {
    console.log(
      `  Symbol '${varName}' not found textually in ${shortPath(targetFile)} ` +
        `(may exist via re-export).`,
    );
  }
  console.log("");

  // Diagnosis block
  if (diag.hadError) {
    console.log("  TS2589 fired.");
    console.log(`  Inferred counter: ${diag.inferredCounter ?? "unknown"}`);
  } else if (diag.depthLimitHits > 0 || diag.relatedToLimitHits > 0) {
    console.log("  No TS2589, but the depth ceiling was approached:");
    console.log(
      `    ${diag.depthLimitHits} instantiateType_DepthLimit events ` +
        `(instantiationDepth=100 threshold reached)`,
    );
    console.log(
      `    ${diag.relatedToLimitHits} recursiveTypeRelatedTo_DepthLimit events`,
    );
    console.log(
      "  This is a leading indicator. Adding one more deep call could trip TS2589.",
    );
  } else {
    console.log("  Healthy: no depth-limit events recorded.");
  }
  if (diag.totalInstantiations !== undefined) {
    const pct = ((diag.totalInstantiations / 5_000_000) * 100).toFixed(2);
    console.log(
      `  Total instantiations: ${fmt(diag.totalInstantiations)} ` +
        `(${pct}% of count ceiling, peak per-unit ${fmt(diag.peakInstantiationCount)})`,
    );
  }
  if (diag.checkTimeMs !== undefined) {
    console.log(`  Check time: ${diag.checkTimeMs.toFixed(0)}ms`);
  }
  for (const line of diag.errorLines.slice(0, 3)) {
    console.log(`    ${line.trim()}`);
  }
  console.log("");

  // Depth-limit hits (the most actionable when TS2589 fired)
  if (hits.length > 0) {
    const ownedHits = hits.filter((h) => h.owned);
    const hitBuckets = new Map<string, { hit: DepthLimitHit; count: number }>();
    for (const h of ownedHits.length > 0 ? ownedHits : hits) {
      const key = `${h.symbolName}|${h.filePath}:${h.line}|${h.kind}`;
      const cur = hitBuckets.get(key);
      if (cur) cur.count += 1;
      else hitBuckets.set(key, { hit: h, count: 1 });
    }
    const ranked = Array.from(hitBuckets.values()).sort(
      (a, b) => b.count - a.count,
    );

    console.log("Depth-limit events (where the checker stopped descending):");
    console.log(banner);
    for (const r of ranked.slice(0, 10)) {
      const tag = r.hit.owned ? "★" : " ";
      console.log(
        `  ${tag} ${String(r.count).padStart(5)}×  [${r.hit.kind}]  ` +
          `${r.hit.symbolName}  ${shortPath(r.hit.filePath)}:${r.hit.line}`,
      );
    }
    console.log("");
  }

  // Owned offenders by self-time
  console.log("Top PipeSafe-owned offenders by self-time:");
  console.log(banner);
  if (ownedTop.length === 0) {
    console.log(
      "  (no PipeSafe-owned types in trace — cost may be in lib.es*.d.ts " +
        "or downstream. Look at the all-categories list below.)",
    );
  } else {
    for (const r of ownedTop) {
      const ms = (r.totalUs / 1000).toFixed(1);
      console.log(
        `  ${ms.padStart(8)}ms  ${fmt(r.callCount).padStart(7)}×  ` +
          `${r.symbolName}  ${shortPath(r.filePath)}:${r.line}`,
      );
    }
  }
  console.log("");

  console.log("Top 10 across all categories (★ = PipeSafe-owned):");
  console.log(banner);
  for (const r of allTop) {
    const ms = (r.totalUs / 1000).toFixed(1);
    const prefix = r.owned ? "★" : " ";
    console.log(
      `  ${prefix} ${ms.padStart(8)}ms  ${fmt(r.callCount).padStart(7)}×  ` +
        `${r.symbolName}  ${shortPath(r.filePath)}:${r.line}`,
    );
  }
  console.log("");

  console.log("Trace files:");
  console.log(`  ${traceDir}/trace.json`);
  console.log(`  ${traceDir}/types.json`);
  console.log("");
  console.log(`Open the local viewer:`);
  console.log(`  bun run depth-blame --view ${traceDir}`);
  console.log("");
  console.log("Decision tree: docs/typescript-depth/fix-guide.md §3");
}

// ---------------------------------------------------------------------------
// Viewer launch
// ---------------------------------------------------------------------------

function openViewer(traceDir: string | undefined): void {
  const viewerHtml = resolve(REPO_ROOT, ".claude/depth-viewer/index.html");
  if (!existsSync(viewerHtml)) {
    console.error(`Viewer not found at ${viewerHtml}.`);
    process.exit(2);
  }
  const url = traceDir
    ? `file://${viewerHtml}?trace=${encodeURIComponent(resolve(traceDir))}`
    : `file://${viewerHtml}`;

  console.log(`Open this URL in your browser:`);
  console.log(`  ${url}`);
  console.log("");
  console.log(
    "Browsers block file:// fetches — drag-and-drop trace.json onto the " +
      "viewer's drop zone if the URL parameter doesn't auto-load.",
  );

  if (!process.env["DISPLAY"] && process.platform === "linux") return;
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  spawnSync(opener, [url], { stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function main(): void {
  const targetFile = resolveTargetFile();
  console.log(`Generating trace via owning tsconfig of ${shortPath(targetFile)}...`);

  const { traceDir, stdout, stderr, workDir, exitCode, owningTsconfig } =
    generateTrace(targetFile);

  if (!existsSync(join(traceDir, "trace.json"))) {
    console.error(`tsc failed before writing the trace (exit=${exitCode}).`);
    if (stderr.trim()) console.error(stderr);
    if (stdout.trim()) console.error(stdout);
    rmSync(workDir, { recursive: true, force: true });
    process.exit(4);
  }

  const { events, types } = loadTrace(traceDir);
  const diag = diagnoseDepthErrors(stdout, stderr, events);
  const offenders = aggregateOffenders(events, types);
  const hits = aggregateDepthLimitHits(events, types);
  printReport(targetFile, diag, offenders, hits, traceDir, owningTsconfig);
  // Don't delete workDir — the user needs the trace files for the viewer.
}

main();
