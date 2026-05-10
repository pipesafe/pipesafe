#!/usr/bin/env bun
/**
 * depth-viewer/build — generate the static dataset the React app queries.
 *
 * Pipeline:
 *   1. Run tsc --generateTrace on packages/core (heaviest target). Optional
 *      --project flag picks a different tsconfig.
 *   2. Parse trace.json (events) + types.json (type table).
 *   3. Aggregate per-type self-time and call count.
 *   4. Carry forward the parent-of relationship (`instantiatedType`) so the
 *      viewer can build a call tree client-side.
 *   5. Walk the project's source files with ts-morph, collect every top-level
 *      declaration with its source line range — this is the picker index.
 *   6. Emit public/data/{types,index,meta}.json so Vite serves them.
 *
 * The viewer runs entirely off these JSON files; no on-demand tsc invocations.
 *
 * Usage:
 *   bun run build.ts
 *   bun run build.ts --project ../../packages/manifold/tsconfig.json
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Project } from "ts-morph";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const DATA_DIR = resolve(HERE, "public/data");

interface RawTypeEntry {
  id: number;
  symbolName?: string;
  intrinsicName?: string;
  display?: string;
  flags?: string[];
  instantiatedType?: number;
  firstDeclaration?: {
    path: string;
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface TraceEvent {
  ph: string;
  cat?: string;
  name?: string;
  dur?: number;
  args?: Record<string, unknown>;
}

interface AggregatedType {
  id: number;
  name: string;
  file?: string;
  line?: number;
  endLine?: number;
  totalUs: number;
  callCount: number;
  parent?: number;
}

interface SymbolEntry {
  name: string;
  kind: "const" | "let" | "var" | "type" | "interface" | "function";
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
}

interface ExpressionCost {
  pos: number;
  end: number;
  totalUs: number;
  callCount: number;
}

const args = process.argv.slice(2);
const projectFlagIdx = args.indexOf("--project");
const projectArg =
  projectFlagIdx >= 0 ?
    args[projectFlagIdx + 1]
  : "packages/core/tsconfig.json";

if (!projectArg) {
  console.error("--project requires a path argument");
  process.exit(2);
}

const tsconfigPath = resolve(REPO_ROOT, projectArg);
if (!existsSync(tsconfigPath)) {
  console.error(`tsconfig not found: ${tsconfigPath}`);
  process.exit(2);
}

function findTscBin(): string {
  const local = resolve(REPO_ROOT, "node_modules/.bin/tsc");
  if (!existsSync(local)) {
    console.error(`Local tsc not found at ${local}. Run 'bun install'.`);
    process.exit(2);
  }
  return local;
}

function generateTrace(): string {
  const workDir = mkdtempSync(join(tmpdir(), "depth-viewer-"));
  const traceDir = join(workDir, "trace");
  mkdirSync(traceDir, { recursive: true });

  const buildInfo = join(dirname(tsconfigPath), "tsconfig.tsbuildinfo");
  if (existsSync(buildInfo)) rmSync(buildInfo);

  console.log(
    `Running tsc --generateTrace on ${relative(REPO_ROOT, tsconfigPath)}...`
  );
  const result = spawnSync(
    findTscBin(),
    [
      "-p",
      tsconfigPath,
      "--noEmit",
      "--generateTrace",
      traceDir,
      "--extendedDiagnostics",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 }
  );

  if (!existsSync(join(traceDir, "trace.json"))) {
    console.error(`tsc failed to write trace (exit=${result.status}).`);
    if (result.stderr.trim()) console.error(result.stderr);
    process.exit(3);
  }
  return traceDir;
}

function parseJsonArray<T>(path: string): T[] {
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
        // ignore malformed trailing line (tsc occasionally truncates)
      }
    }
    return out;
  }
}

function aggregate(traceDir: string): {
  types: AggregatedType[];
  expressions: Record<string, ExpressionCost[]>;
  meta: Record<string, unknown>;
} {
  const events = parseJsonArray<TraceEvent>(join(traceDir, "trace.json"));
  const rawTypes = parseJsonArray<RawTypeEntry>(join(traceDir, "types.json"));

  const typeById = new Map<number, RawTypeEntry>();
  for (const t of rawTypes) typeById.set(t.id, t);

  // Walk up the instantiatedType chain until we hit a type with a symbolName,
  // matching depth-blame's resolveType behavior. This collapses anonymous
  // instantiation rings into their named ancestor.
  function resolveNamed(id: number): RawTypeEntry | undefined {
    let cur = typeById.get(id);
    let hops = 0;
    while (cur && !cur.symbolName && hops < 8) {
      if (cur.instantiatedType === undefined) break;
      cur = typeById.get(cur.instantiatedType);
      hops += 1;
    }
    return cur;
  }

  const agg = new Map<number, AggregatedType>();
  let totalUs = 0;
  let totalCalls = 0;
  for (const ev of events) {
    if (ev.ph !== "X" || !ev.dur || !ev.args || ev.cat !== "checkTypes")
      continue;
    const args = ev.args;
    const idCandidate =
      (args["typeId"] as number | undefined) ??
      (args["sourceId"] as number | undefined) ??
      (args["targetId"] as number | undefined);
    if (idCandidate === undefined) continue;
    const named = resolveNamed(idCandidate);
    const id = named?.id ?? idCandidate;

    let row = agg.get(id);
    if (!row) {
      row = {
        id,
        name: named?.symbolName ?? named?.intrinsicName ?? `Type#${id}`,
        ...(named?.firstDeclaration?.path !== undefined && {
          file: relative(REPO_ROOT, named.firstDeclaration.path),
        }),
        ...(named?.firstDeclaration?.start.line !== undefined && {
          line: named.firstDeclaration.start.line,
        }),
        ...(named?.firstDeclaration?.end.line !== undefined && {
          endLine: named.firstDeclaration.end.line,
        }),
        totalUs: 0,
        callCount: 0,
        ...(named?.instantiatedType !== undefined && {
          parent: named.instantiatedType,
        }),
      };
      agg.set(id, row);
    }
    row.totalUs += ev.dur;
    row.callCount += 1;
    totalUs += ev.dur;
    totalCalls += 1;
  }

  let depthLimit = 0;
  let relatedLimit = 0;
  let peakInstantiationCount = 0;
  for (const ev of events) {
    if (ev.name === "instantiateType_DepthLimit") {
      depthLimit += 1;
      const c = (ev.args?.["instantiationCount"] as number | undefined) ?? 0;
      if (c > peakInstantiationCount) peakInstantiationCount = c;
    } else if (ev.name === "recursiveTypeRelatedTo_DepthLimit") {
      relatedLimit += 1;
    }
  }

  // Per-expression rollup: every checkExpression / checkVariableDeclaration
  // event keyed by (path, pos, end). The viewer uses this to attribute cost to
  // the user's selected symbol via overlapping positions, independent of where
  // the types themselves are defined.
  const exprByFile = new Map<string, Map<string, ExpressionCost>>();
  for (const ev of events) {
    if (ev.ph !== "X" || !ev.dur || !ev.args || ev.cat !== "check") continue;
    const path = ev.args["path"];
    const pos = ev.args["pos"];
    const end = ev.args["end"];
    if (
      typeof path !== "string" ||
      typeof pos !== "number" ||
      typeof end !== "number"
    )
      continue;
    const rel = relative(REPO_ROOT, path);
    if (rel.startsWith("..") || rel.includes("node_modules")) continue;
    let bucket = exprByFile.get(rel);
    if (!bucket) {
      bucket = new Map<string, ExpressionCost>();
      exprByFile.set(rel, bucket);
    }
    const key = `${pos}-${end}`;
    let row = bucket.get(key);
    if (!row) {
      row = { pos, end, totalUs: 0, callCount: 0 };
      bucket.set(key, row);
    }
    row.totalUs += ev.dur;
    row.callCount += 1;
  }
  const expressions: Record<string, ExpressionCost[]> = {};
  for (const [file, bucket] of exprByFile) {
    expressions[file] = Array.from(bucket.values()).sort(
      (a, b) => b.totalUs - a.totalUs
    );
  }

  return {
    types: Array.from(agg.values()),
    expressions,
    meta: {
      project: relative(REPO_ROOT, tsconfigPath),
      generatedAt: new Date().toISOString(),
      totalEvents: events.length,
      totalCheckTypes: totalCalls,
      totalUs,
      uniqueTypes: agg.size,
      depthLimitHits: depthLimit,
      relatedToLimitHits: relatedLimit,
      peakInstantiationCount,
      ceilings: {
        instantiationDepth: 100,
        instantiationCount: 5_000_000,
        tailCount: 1_000,
      },
    },
  };
}

function buildSymbolIndex(): Record<string, SymbolEntry[]> {
  console.log("Building symbol index with ts-morph...");
  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
  });

  const out: Record<string, SymbolEntry[]> = {};
  for (const sf of project.getSourceFiles()) {
    const file = relative(REPO_ROOT, sf.getFilePath());
    if (file.includes("node_modules") || file.startsWith("..")) continue;
    const entries: SymbolEntry[] = [];

    for (const v of sf.getVariableDeclarations()) {
      const stmt = v.getVariableStatement();
      const declKind = stmt?.getDeclarationKind();
      const kind: SymbolEntry["kind"] =
        declKind === "let" ? "let"
        : declKind === "var" ? "var"
        : "const";
      entries.push({
        name: v.getName(),
        kind,
        startLine: v.getStartLineNumber(),
        endLine: v.getEndLineNumber(),
        startPos: v.getStart(),
        endPos: v.getEnd(),
      });
    }
    for (const t of sf.getTypeAliases()) {
      entries.push({
        name: t.getName(),
        kind: "type",
        startLine: t.getStartLineNumber(),
        endLine: t.getEndLineNumber(),
        startPos: t.getStart(),
        endPos: t.getEnd(),
      });
    }
    for (const i of sf.getInterfaces()) {
      entries.push({
        name: i.getName(),
        kind: "interface",
        startLine: i.getStartLineNumber(),
        endLine: i.getEndLineNumber(),
        startPos: i.getStart(),
        endPos: i.getEnd(),
      });
    }
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      entries.push({
        name,
        kind: "function",
        startLine: fn.getStartLineNumber(),
        endLine: fn.getEndLineNumber(),
        startPos: fn.getStart(),
        endPos: fn.getEnd(),
      });
    }

    if (entries.length > 0) {
      entries.sort((a, b) => a.startLine - b.startLine);
      out[file] = entries;
    }
  }
  return out;
}

function main(): void {
  mkdirSync(DATA_DIR, { recursive: true });

  const traceDir = generateTrace();
  console.log("Aggregating trace...");
  const { types, expressions, meta } = aggregate(traceDir);
  const index = buildSymbolIndex();

  const filtered = types.filter((t) => t.totalUs > 0);
  filtered.sort((a, b) => b.totalUs - a.totalUs);

  writeFileSync(join(DATA_DIR, "types.json"), JSON.stringify(filtered));
  writeFileSync(
    join(DATA_DIR, "expressions.json"),
    JSON.stringify(expressions)
  );
  writeFileSync(join(DATA_DIR, "index.json"), JSON.stringify(index));
  writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  let exprCount = 0;
  for (const list of Object.values(expressions)) exprCount += list.length;

  console.log("");
  console.log(
    `Wrote ${filtered.length} types, ${exprCount} expressions, ` +
      `${Object.keys(index).length} files.`
  );
  console.log(
    `Total checkTypes time: ${((meta["totalUs"] as number) / 1000).toFixed(0)}ms`
  );
  console.log("");
  console.log(`Output: ${relative(REPO_ROOT, DATA_DIR)}/`);
  console.log(`Trace files preserved at ${traceDir}`);
}

main();
