#!/usr/bin/env bun
/**
 * depth-viewer/query — interrogate the dataset emitted by `depth-view:build`.
 *
 * The build pipeline writes per-symbol stats to
 * `tools/depth-viewer/public/data/index.json`. This CLI exposes those stats
 * for terminal and programmatic use: rank top offenders, look up a single
 * symbol, search reverse references, list per-file symbols. Output is
 * `--format table` (default, human-readable) or `--format json` (machine).
 *
 * Run `bun run depth-view:build` first to refresh the dataset.
 *
 * Examples
 *   # Top 20 hottest symbols across the codebase
 *   bun run depth-view:query top
 *
 *   # Top 20 by call-site count instead of entries
 *   bun run depth-view:query top --by callSites
 *
 *   # Full JSON for one symbol (disambiguate with --file when ambiguous)
 *   bun run depth-view:query symbol Prettify
 *   bun run depth-view:query symbol concatPipeline \
 *     --file packages/core/src/pipeline/Pipeline.examples.ts
 *
 *   # Every symbol that textually references Prettify
 *   bun run depth-view:query refs Prettify
 *
 *   # All symbols in a file, ranked by entries
 *   bun run depth-view:query file packages/core/src/utils/updates.ts
 *
 *   # Meta totals (project tsconfig, file count, registry sizes)
 *   bun run depth-view:query meta
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "public/data");

interface SymbolReference {
  name: string;
  line: number;
}

interface ChainStep {
  label: string;
  member?: string;
  declaredReturnType?: string;
  declaredAt?: { file: string; line: number };
  resolvedType: string;
  callLine: number;
  maxDepth?: number;
  ownDepth?: number;
  maxTail?: number;
  maxCount?: number;
  hitDepthLimit?: boolean;
  hitTailLimit?: boolean;
  hitCountLimit?: boolean;
  depthInferred?: boolean;
}

interface InferredTypeInfo {
  display: string;
  truncated: boolean;
  depth?: number;
  hitDepthLimit: boolean;
  tail?: number;
  hitTailLimit: boolean;
  count?: number;
  hitCountLimit: boolean;
  errored: boolean;
  walkLimited: boolean;
  uniqueTypes: number;
  referencedNames: { name: string; count: number }[];
  chain?: ChainStep[];
}

interface SymbolStats {
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  references: SymbolReference[];
  entriesCreated: number;
  entriesByKind: Record<string, number>;
  callSites: number;
  inferred?: InferredTypeInfo;
}

interface Meta {
  project: string;
  generatedAt: string;
  totalEntries: number;
  ownedEntries: number;
  totalSymbols: number;
  ceilings: Record<string, number>;
}

type Index = Record<string, SymbolStats[]>;

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

function loadIndex(): Index {
  const path = resolve(DATA_DIR, "index.json");
  if (!existsSync(path)) {
    console.error(
      `Dataset missing at ${path}. Run 'bun run depth-view:build' first.`
    );
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Index;
}

function loadMeta(): Meta {
  const path = resolve(DATA_DIR, "meta.json");
  if (!existsSync(path)) {
    console.error(`Dataset missing at ${path}.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Meta;
}

function flatten(idx: Index): SymbolStats[] {
  return Object.values(idx).flat();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function emit(data: unknown, format: "table" | "json"): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (data.length === 0) {
    console.log("(no results)");
    return;
  }
  // Table mode: pick the most useful columns from each row shape. The query
  // commands populate a uniform `{ name, kind, file, startLine, entriesCreated,
  // callSites, ... }` shape, so a generic key-extractor is fine.
  const rows = data as Record<string, unknown>[];
  const keys = Object.keys(rows[0] ?? {});
  const widths = new Map<string, number>(
    keys.map((k) => [
      k,
      Math.max(k.length, ...rows.map((r) => fmt(r[k]).length)),
    ])
  );
  const headers = keys.map((k) => k.padEnd(widths.get(k)!)).join("  ");
  const sep = keys.map((k) => "-".repeat(widths.get(k)!)).join("  ");
  console.log(headers);
  console.log(sep);
  for (const r of rows) {
    console.log(keys.map((k) => fmt(r[k]).padEnd(widths.get(k)!)).join("  "));
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`--${name} requires a value`);
    usage();
  }
  return value;
}

function usage(): never {
  console.log(`Usage:
  bun run depth-view:query top [--by entriesCreated|callSites|depth|uniqueTypes] [--limit N] [--kind type|class|const|...] [--format table|json]
  bun run depth-view:query symbol <name> [--file <path>] [--format table|json]
  bun run depth-view:query refs <name> [--limit N] [--format table|json]
  bun run depth-view:query file <path> [--format table|json]
  bun run depth-view:query meta [--format table|json]

Reads tools/depth-viewer/public/data/. Refresh with 'bun run depth-view:build'.`);
  process.exit(1);
}

const command = argv[0];
if (!command || command === "--help" || command === "-h") usage();

const formatRaw = flag("format") ?? "table";
if (formatRaw !== "table" && formatRaw !== "json") {
  console.error(`--format must be 'table' or 'json', got '${formatRaw}'`);
  usage();
}
const format: "table" | "json" = formatRaw;
const limit = Number(flag("limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1) {
  console.error(`--limit must be a positive integer, got '${flag("limit")}'`);
  usage();
}

switch (command) {
  case "top": {
    const by = flag("by") ?? "entriesCreated";
    const kind = flag("kind");
    const all = flatten(loadIndex()).filter((s) => !kind || s.kind === kind);
    const score = (s: SymbolStats): number => {
      switch (by) {
        case "callSites":
          return s.callSites;
        case "depth":
          return s.inferred?.depth ?? 0;
        case "uniqueTypes":
          return s.inferred?.uniqueTypes ?? 0;
        case "entriesCreated":
        default:
          return s.entriesCreated;
      }
    };
    const top = all
      .filter((s) => score(s) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit)
      .map((s) => ({
        name: s.name,
        kind: s.kind,
        location: `${s.file}:${s.startLine}`,
        entriesCreated: s.entriesCreated,
        callSites: s.callSites,
        uniqueTypes: s.inferred?.uniqueTypes ?? 0,
        depth: s.inferred?.depth ?? 0,
      }));
    emit(top, format);
    break;
  }
  case "symbol": {
    const name = argv[1];
    if (!name) usage();
    const file = flag("file");
    const candidates = flatten(loadIndex()).filter(
      (s) => s.name === name && (!file || s.file === file)
    );
    if (candidates.length === 0) {
      console.error(`No symbol named '${name}'${file ? ` in ${file}` : ""}`);
      process.exit(3);
    }
    if (candidates.length > 1 && format === "table") {
      console.error(
        `'${name}' resolves to ${candidates.length} symbols; disambiguate with --file:`
      );
      for (const c of candidates) console.error(`  ${c.file}:${c.startLine}`);
      process.exit(3);
    }
    emit(candidates.length === 1 ? candidates[0] : candidates, format);
    break;
  }
  case "refs": {
    const name = argv[1];
    if (!name) usage();
    const refs = flatten(loadIndex())
      .filter((s) => s.references.some((r) => r.name === name))
      .map((s) => {
        const occ = s.references.filter((r) => r.name === name).length;
        return {
          name: s.name,
          kind: s.kind,
          location: `${s.file}:${s.startLine}`,
          occurrences: occ,
          entriesCreated: s.entriesCreated,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, limit);
    emit(refs, format);
    break;
  }
  case "file": {
    const path = argv[1];
    if (!path) usage();
    const idx = loadIndex();
    const list = idx[path];
    if (!list) {
      console.error(`No symbols indexed for '${path}'`);
      process.exit(3);
    }
    const ranked = [...list]
      .sort((a, b) => b.entriesCreated - a.entriesCreated)
      .map((s) => ({
        name: s.name,
        kind: s.kind,
        line: s.startLine,
        entriesCreated: s.entriesCreated,
        callSites: s.callSites,
        uniqueTypes: s.inferred?.uniqueTypes ?? 0,
      }));
    emit(ranked, format);
    break;
  }
  case "meta": {
    emit(loadMeta(), format);
    break;
  }
  default:
    usage();
}
