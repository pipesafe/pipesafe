#!/usr/bin/env bun
/**
 * depth-viewer/build — generate the static dataset the React app queries.
 *
 * Data model
 * ----------
 * Per source-declared symbol (const/let/var/type/interface/function):
 *   - position + source text (for the snippet renderer)
 *   - entries created: count of types.json registry entries whose
 *     firstDeclaration overlaps this symbol's source range — the honest
 *     measure of how much the checker materialised here
 *   - kind breakdown (Object / Conditional / Union / TypeParameter / …)
 *   - call sites (for types/interfaces): textual TypeReferences pointing
 *     at this name across the whole project
 *   - references: type names mentioned inside this symbol's range
 *
 * The per-symbol dataset is derived from tsc's full (non-sampled) `types.json`
 * and the Compiler API. The accompanying `trace.json` is generated through a
 * depth-stats-patched copy of tsc (see patch-tsc.ts) so every event carries the
 * checker's live instantiation-depth counters, and is preserved for downstream
 * use; the sampled `X` spans within it remain 10ms-sampled / machine-dependent,
 * but the instant and begin/end events are deterministic.
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

import ts from "typescript";

import { DEPTH_STEP_EVENT, materializePatchedTsc } from "./patch-tsc";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const DATA_DIR = resolve(HERE, "public/data");

// Run the trace through a depth-stats-patched copy of tsc by default (see
// patch-tsc.ts) so every trace event carries instantiation-depth stats. Set
// DEPTH_VIEWER_NO_PATCH=1 (or pass --no-patch) to fall back to stock tsc.
const USE_PATCHED_TSC =
  !argvHas("--no-patch") && process.env.DEPTH_VIEWER_NO_PATCH !== "1";

function argvHas(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface RawTypeEntry {
  id: number;
  symbolName?: string;
  intrinsicName?: string;
  display?: string;
  flags?: string[];
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
interface RawDepthStep {
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
  /** Monotonic totalInstantiationCount bracketing this node's subtree. */
  enterTotalCount: number;
  exitTotalCount: number;
}

/** Aggregated per-node depth stats, keyed by `${path.toLowerCase()}::${end}`. */
interface DepthRecord {
  kind: number;
  pos: number;
  end: number;
  enterDepth: number;
  spanPeakDepth: number;
  selfPeakDepth: number;
  spanPeakTail: number;
  selfPeakTail: number;
  selfCount: number;
  enterTotalCount: number;
  exitTotalCount: number;
}

type SymbolKind =
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "function"
  | "class";

interface SymbolReference {
  name: string;
  line: number; // 1-indexed
}

interface ChainStep {
  label: string;
  member?: string;
  declaredReturnType?: string;
  declaredAt?: { file: string; line: number };
  resolvedType: string;
  callLine: number;
  /**
   * Peak instantiation depth the checker reached while computing this step's
   * type, from the patched tsc trace (NOT walked from the resolved type). The
   * peak over the step's whole subtree; post-processed to a running max along
   * the chain so it never reads as shallower than a step nested inside it, and
   * saturates at 100 when TS2589's depth ceiling fires. Absent only if no trace
   * record matched and no earlier step had one.
   */
  maxDepth?: number;
  /**
   * Depth this step's OWN signature/return resolution added — the self peak
   * (reset on every nested expression) minus the ambient entry depth. A subtle
   * marginal, surfaced in the tooltip only; absent for inferred steps.
   */
  ownDepth?: number;
  /**
   * Peak tail-recursive conditional-type elaboration count for this step. A
   * separate TS2589 trigger (ceiling 1000) that fires with low instantiation
   * depth, so a step can be healthy on {@link maxDepth} yet trip here. 0 if no
   * tail recursion ran.
   */
  maxTail?: number;
  /**
   * Peak per-unit instantiationCount for this step. The third TS2589 trigger
   * (ceiling 5,000,000); this is what collapses the whole accumulated type to
   * the error type (`any`) when one step's resolution does millions of
   * instantiations. Climbs along the chain with the accumulated type's size.
   */
  maxCount?: number;
  /** True when {@link maxDepth} reached the 100 instantiation-depth ceiling. */
  hitDepthLimit?: boolean;
  /** True when {@link maxTail} reached the 1000 tail-recursion ceiling. */
  hitTailLimit?: boolean;
  /** True when {@link maxCount} reached the 5,000,000 instantiation-count ceiling. */
  hitCountLimit?: boolean;
  /**
   * True when this step carried no trace record and its peaks were derived from
   * the steps nested inside it (the outermost step short-circuits after an inner
   * step trips TS2589). The peak is a valid lower bound; `ownDepth` is not
   * measured for it.
   */
  depthInferred?: boolean;
}

interface InferredTypeInfo {
  display: string;
  truncated: boolean;
  /**
   * Max instantiation depth reached anywhere in this declaration, sourced from
   * the patched tsc trace (the peak `instantiationDepth`, not a structural walk
   * of the resolved type). `undefined` when no Call/New expression in the
   * declaration produced a trace record (e.g. a plain object-literal const).
   */
  depth?: number;
  /** True when {@link depth} reached the 100 ceiling (TS2589 territory). */
  hitDepthLimit: boolean;
  /**
   * Max tail-recursive conditional-type elaboration count across the
   * declaration, from the trace. A separate TS2589 trigger (ceiling 1000).
   * `undefined` when no Call/New step produced a trace record.
   */
  tail?: number;
  /** True when {@link tail} reached the 1000 tail-recursion ceiling. */
  hitTailLimit: boolean;
  /**
   * Max per-unit instantiationCount across the declaration, from the trace. The
   * third TS2589 trigger (ceiling 5,000,000) — the one that collapses the whole
   * type to `any`. `undefined` when no Call/New step produced a trace record.
   */
  count?: number;
  /** True when {@link count} reached the 5,000,000 instantiation-count ceiling. */
  hitCountLimit: boolean;
  /**
   * True when the checker handed back an error type for this declaration —
   * typically the TS2589 "excessively deep" bail. The resolved type is then
   * meaningless, so `uniqueTypes`/`display` should be read with that in mind.
   */
  errored: boolean;
  /** Whether the structural walk (used only for uniqueTypes) hit its cap. */
  walkLimited: boolean;
  /** Number of distinct ts.Type instances visited while walking (coverage only). */
  uniqueTypes: number;
  referencedNames: { name: string; count: number }[];
  chain?: ChainStep[];
}

interface SymbolStats {
  name: string;
  kind: SymbolKind;
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const projectFlagIdx = argv.indexOf("--project");
// Default to the viewer's coverage tsconfig — it directly includes both
// packages' src + examples + benchmarking as raw source. We can't use the
// workspace root tsconfig because its `references` make tsc resolve the
// referenced projects through their dist/*.d.mts outputs, robbing the
// trace of source-level instantiation attribution.
const projectArg =
  projectFlagIdx >= 0 ?
    argv[projectFlagIdx + 1]
  : "tools/depth-viewer/tsconfig.coverage.json";

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

  // Resolve the compiler. By default a depth-stats-patched copy of tsc, run via
  // the current node, so the trace carries per-event instantiation-depth stats.
  let command: string;
  let baseArgs: string[];
  if (USE_PATCHED_TSC) {
    const { path: patchedTsc, cached } = materializePatchedTsc({
      repoRoot: REPO_ROOT,
    });
    console.log(
      `Using depth-stats-patched tsc (${cached ? "cached" : "freshly patched"}): ${relative(REPO_ROOT, patchedTsc)}`
    );
    command = process.execPath;
    baseArgs = [patchedTsc];
  } else {
    console.log("Using stock tsc (--no-patch): no depth stats in trace.");
    command = findTscBin();
    baseArgs = [];
  }

  console.log(
    `Running tsc --generateTrace on ${relative(REPO_ROOT, tsconfigPath)}...`
  );
  const result = spawnSync(
    command,
    [
      ...baseArgs,
      "-p",
      tsconfigPath,
      "--noEmit",
      "--generateTrace",
      traceDir,
      "--extendedDiagnostics",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 }
  );

  if (!existsSync(join(traceDir, "types.json"))) {
    console.error(`tsc failed to write types.json (exit=${result.status}).`);
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
        // tsc occasionally truncates the trailing line; ignore.
      }
    }
    return out;
  }
}

// Aggregate raw `depthStep` payloads into the per-node index. checkExpression
// runs a node more than once (contextual typing, overload resolution, re-checks)
// and the patch emits a depthStep on every pass, so each (path,end) can have
// several records. The canonical one is the deepest pass (max spanPeakDepth),
// tie-broken by the largest subtree (max exitTotalCount) — both criteria are
// total orders over the data, so the choice is deterministic. All fields of the
// chosen record come from that single pass, so enter/exitTotalCount stay a
// coherent pair (no cross-pass mixing). Exported for tests.
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
function parseDepthSteps(traceDir: string): DepthIndex {
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

// ---------------------------------------------------------------------------
// Path canonicalization
// ---------------------------------------------------------------------------

// tsc lowercases trace paths on macOS. Canonicalize against the actual source
// files (with their real case) so picker paths and trace paths match.
function normalizeTracePath(
  p: string,
  caseMap: Map<string, string>
): string | null {
  const abs = resolve(REPO_ROOT, p);
  const lowerAbs = abs.toLowerCase();
  const lowerRoot = REPO_ROOT.toLowerCase() + "/";
  if (!lowerAbs.startsWith(lowerRoot)) return null;
  const lowerRel = lowerAbs.slice(lowerRoot.length);
  return caseMap.get(lowerRel) ?? null;
}

// ---------------------------------------------------------------------------
// AST pass (raw TypeScript API — ts-morph dropped)
// ---------------------------------------------------------------------------

interface ScannedSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  references: SymbolReference[];
  inferred?: InferredTypeInfo;
}

// ---------------------------------------------------------------------------
// Inferred-type walker
// ---------------------------------------------------------------------------
//
// Per value declaration, ask the checker for the type it actually inferred
// (distinct from the declared annotation), then walk that type's tree to
// produce a display string, depth, and a count of distinct ts.Type instances
// reached. This is the "what does the const actually resolve to and how
// expensive is that resolution" picture — exactly what the picker's
// declared-references view leaves out.
//
// The walker is bounded (MAX_TYPES, MAX_DEPTH) to keep build time finite on
// pipesafe-scale projects where a single Pipeline chain's inferred type can
// reach thousands of unique ts.Type objects.

// Walker caps. Generous on depth — class chains (Pipeline + methods)
// produce long chains via call-signature returns even with id-dedup. Cap
// exists only to keep the build finite on pathological inputs.
const MAX_WALK_TYPES = 20_000;
const MAX_WALK_DEPTH = 500;
const MAX_DISPLAY_LENGTH = 8000;

// The checker's TS2589 ceilings. Reaching either is what raises the
// "excessively deep" error. Mirrored from the `instantiationDepth === 100` and
// `tailCount === 1000` guards in _tsc.js (see patch-tsc.ts) and meta.json.
const DEPTH_CEILING = 100;
const TAIL_CEILING = 1000;
const COUNT_CEILING = 5_000_000;

// Walk a variable's initializer expression backwards through every call /
// new expression, recording each step's *declared* return-type annotation
// (un-evaluated source text) plus its *resolved* type (what TS actually
// computed at that site). The declared form preserves type expressions
// like `ResolveSetOutput<S, PreviousStageDocs>` that the resolved form has
// already eagerly reduced — the only way to see the chain that produced
// the final shape.
// Per-node depth records keyed by `${absolutePathLowercased}::${node.end}`.
// `node.end` is unique per Call/New node within a file (chain steps share a
// start but their ends strictly increase), so it's a stable join key against
// the AST. Lowercasing both sides absorbs tsc's macOS path-casing.
type DepthIndex = Map<string, DepthRecord>;

function depthKey(absPathLower: string, end: number): string {
  return `${absPathLower}::${end}`;
}

function buildInitializerChain(
  checker: ts.TypeChecker,
  decl: ts.VariableDeclaration,
  depthIndex: DepthIndex
): ChainStep[] | undefined {
  const init = decl.initializer;
  if (!init) return undefined;

  // Collect call/new expressions from outermost to innermost — that's how a
  // chain `new Pipeline<…>().set(...).set(...).set(...)` is parsed
  // (left-fold via PropertyAccessExpression). We then reverse to render in
  // execution order.
  const calls: (ts.CallExpression | ts.NewExpression)[] = [];
  let cursor: ts.Expression | undefined = init;
  while (cursor) {
    if (ts.isCallExpression(cursor) || ts.isNewExpression(cursor)) {
      calls.push(cursor);
      if (
        ts.isCallExpression(cursor) &&
        ts.isPropertyAccessExpression(cursor.expression)
      ) {
        cursor = cursor.expression.expression;
      } else if (
        ts.isCallExpression(cursor) &&
        ts.isElementAccessExpression(cursor.expression)
      ) {
        cursor = cursor.expression.expression;
      } else {
        cursor = undefined;
      }
    } else if (ts.isPropertyAccessExpression(cursor)) {
      cursor = cursor.expression;
    } else {
      cursor = undefined;
    }
  }
  if (calls.length === 0) return undefined;
  calls.reverse();

  const sf = decl.getSourceFile();
  const absLower = sf.fileName.toLowerCase();
  const out: ChainStep[] = [];
  // Trace record per step, in execution order, for marginal-count deltas.
  const records: (DepthRecord | undefined)[] = [];
  for (const call of calls) {
    const callLine =
      sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    let label: string;
    let member: string | undefined;
    if (ts.isNewExpression(call)) {
      label = `new ${call.expression.getText(sf)}(${call.typeArguments ? `<${call.typeArguments.map((a) => a.getText(sf)).join(", ")}>` : ""}…)`;
    } else if (ts.isPropertyAccessExpression(call.expression)) {
      member = call.expression.name.text;
      label = `.${member}(…)`;
    } else {
      label = call.expression.getText(sf).slice(0, 60) + "(…)";
    }

    const resolvedType = checker.typeToString(
      checker.getTypeAtLocation(call),
      decl,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.WriteArrayAsGenericType |
        ts.TypeFormatFlags.NoTypeReduction
    );

    let declaredReturnType: string | undefined;
    let declaredAt: { file: string; line: number } | undefined;
    try {
      const sig = checker.getResolvedSignature(call);
      const sigDecl = sig?.declaration;
      if (
        sigDecl &&
        (ts.isMethodDeclaration(sigDecl) ||
          ts.isFunctionDeclaration(sigDecl) ||
          ts.isMethodSignature(sigDecl) ||
          ts.isCallSignatureDeclaration(sigDecl) ||
          ts.isConstructorDeclaration(sigDecl) ||
          ts.isConstructSignatureDeclaration(sigDecl) ||
          ts.isFunctionTypeNode(sigDecl) ||
          ts.isArrowFunction(sigDecl) ||
          ts.isFunctionExpression(sigDecl))
      ) {
        const declSf = sigDecl.getSourceFile();
        const declFile = relative(REPO_ROOT, declSf.fileName);
        const declLine =
          declSf.getLineAndCharacterOfPosition(sigDecl.getStart(declSf)).line +
          1;
        declaredAt = { file: declFile, line: declLine };
        if (sigDecl.type) {
          declaredReturnType = sigDecl.type.getText(declSf);
        }
      }
    } catch {
      // signature resolution failures shouldn't abort the build.
    }

    const step: ChainStep = { label, callLine, resolvedType };
    if (member) step.member = member;
    if (declaredReturnType) step.declaredReturnType = declaredReturnType;
    if (declaredAt) step.declaredAt = declaredAt;

    // Join this call/new node to its deterministic trace record by source end.
    const rec = depthIndex.get(depthKey(absLower, call.getEnd()));
    records.push(rec);
    if (rec) {
      step.maxDepth = rec.spanPeakDepth;
      // Marginal depth this step's OWN resolution added, above the ambient
      // entry depth (selfPeakDepth is absolute). Clamped at 0.
      step.ownDepth = Math.max(0, rec.selfPeakDepth - rec.enterDepth);
      step.maxTail = rec.spanPeakTail;
      // Marginal instantiations THIS step performed (not inherited). Spikes at
      // the culprit step and is ~0 once the type has collapsed to `any`.
      step.maxCount = rec.selfCount;
      step.hitCountLimit = rec.selfCount >= COUNT_CEILING;
    }
    out.push(step);
  }

  // Post-process the PEAK metrics (depth, tail) to a running max along the chain.
  // The chain is linear — step i's call expression textually contains every
  // earlier step — so its instantiation subtree contains theirs and its true
  // peak is >= every earlier step's. Within ONE checkExpression pass the patch
  // guarantees that (it propagates span peaks up), but each node's CANONICAL
  // record is chosen across passes independently, which can make raw per-step
  // peaks dip. The running max restores the correct monotone profile and
  // recovers steps with NO record at all (the outermost step short-circuits once
  // an inner step trips TS2589 and emits nothing) — flagged `depthInferred`.
  //
  // `maxCount` is deliberately NOT running-maxed: it's the MARGINAL instantiation
  // work each step performs, so it must stay at the culprit step and read ~0 on
  // later steps whose type has already collapsed to `any`. `ownDepth` is likewise
  // left as measured (absent where the step had no record).
  let runDepth: number | undefined;
  let runTail: number | undefined;
  for (const step of out) {
    const hadRecord = step.maxDepth !== undefined;
    if (step.maxDepth !== undefined)
      runDepth = Math.max(runDepth ?? 0, step.maxDepth);
    if (step.maxTail !== undefined)
      runTail = Math.max(runTail ?? 0, step.maxTail);

    if (runDepth !== undefined) {
      step.maxDepth = runDepth;
      step.hitDepthLimit = runDepth >= DEPTH_CEILING;
    }
    if (runTail !== undefined) {
      step.maxTail = runTail;
      step.hitTailLimit = runTail >= TAIL_CEILING;
    }
    if (!hadRecord && runDepth !== undefined) step.depthInferred = true;
  }
  return out;
}

function computeInferredType(
  checker: ts.TypeChecker,
  decl: ts.VariableDeclaration,
  depthIndex: DepthIndex
): InferredTypeInfo {
  const type = checker.getTypeAtLocation(decl);
  // The checker hands back the intrinsic error type when a declaration trips
  // TS2589 (or any other fatal type error). Its resolved form is meaningless —
  // surface that so the UI can stop pretending "depth 0 / 1 unique type" is a
  // real measurement.
  const errored =
    (type.flags & ts.TypeFlags.Any) !== 0 &&
    (type as ts.Type & { intrinsicName?: string }).intrinsicName === "error";
  const rawDisplay = checker.typeToString(
    type,
    decl,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.WriteArrayAsGenericType |
      ts.TypeFormatFlags.NoTypeReduction |
      ts.TypeFormatFlags.UseStructuralFallback |
      ts.TypeFormatFlags.WriteTypeArgumentsOfSignature
  );
  const truncated = rawDisplay.length > MAX_DISPLAY_LENGTH;
  const display =
    truncated ?
      rawDisplay.slice(0, MAX_DISPLAY_LENGTH) +
      `\n…<truncated; full length ${rawDisplay.length} chars>`
    : rawDisplay;

  const seen = new Set<number>();
  // Class-body dedup: a class declaration's body is walked at most once
  // even if the type tree contains many instantiations with different
  // generic args. Without this, chains like `Pipeline.set().match().…`
  // produce a long chain of distinct Type IDs that each trigger a full
  // method-by-method re-walk.
  const walkedClassBodies = new Set<number>();
  const nameTally = new Map<string, number>();
  let walkLimited = false;

  function isLibraryType(t: ts.Type): boolean {
    const decls = t.symbol?.getDeclarations();
    if (!decls || decls.length === 0) return false;
    return decls.every((d2) => d2.getSourceFile().isDeclarationFile);
  }

  const walk = (t: ts.Type | undefined, d: number): void => {
    if (!t) return;
    if (seen.size >= MAX_WALK_TYPES || d > MAX_WALK_DEPTH) {
      walkLimited = true;
      return;
    }
    // Internal but stable across TS versions; the `id` is what the checker
    // uses to deduplicate Type instances.
    const id = (t as ts.Type & { id?: number }).id;
    if (typeof id === "number") {
      if (seen.has(id)) return;
      seen.add(id);
    }

    // Count this type's contribution to the names rollup. Aliases always
    // count (Prettify, ApplySetUpdates, etc.). Otherwise we only count
    // names that correspond to a type declaration — class/interface/type
    // alias/type parameter — not method or property symbols, which would
    // pollute the list with names like `sort`, `push`, `toString` when the
    // walker reaches a class member's signature.
    const aliasName = t.aliasSymbol?.getName();
    let candidateName: string | undefined;
    if (aliasName) {
      candidateName = aliasName;
    } else {
      const sym = t.symbol;
      const symFlags = sym?.flags ?? 0;
      const isTypeSymbol =
        (symFlags &
          (ts.SymbolFlags.Class |
            ts.SymbolFlags.Interface |
            ts.SymbolFlags.TypeAlias |
            ts.SymbolFlags.TypeParameter |
            ts.SymbolFlags.Enum)) !==
        0;
      const symName = sym?.getName();
      if (
        isTypeSymbol &&
        symName &&
        symName !== "__type" &&
        symName !== "__object" &&
        symName !== "__function" &&
        symName !== "__call" &&
        symName !== "__index"
      ) {
        candidateName = symName;
      }
    }
    if (candidateName) {
      nameTally.set(candidateName, (nameTally.get(candidateName) ?? 0) + 1);
    }

    const library = isLibraryType(t);

    // Generic instantiations: walk the resolved type arguments.
    if ((t as ts.TypeReference).target !== undefined) {
      try {
        const typeArgs = checker.getTypeArguments(t as ts.TypeReference);
        for (const ta of typeArgs) walk(ta, d + 1);
      } catch {
        // Some references throw on getTypeArguments (partially-resolved).
      }
    }
    // Alias type arguments are present on alias references like
    // `Prettify<Foo>` and shouldn't be ignored just because the underlying
    // TypeReference machinery already covered them.
    if (t.aliasTypeArguments) {
      for (const ta of t.aliasTypeArguments) walk(ta, d + 1);
    }

    // Unions / intersections.
    if (t.isUnion() || t.isIntersection()) {
      for (const member of t.types) walk(member, d + 1);
    }

    // Conditional types: walk every branch the checker exposes.
    const cond = t as ts.Type & {
      checkType?: ts.Type;
      extendsType?: ts.Type;
      resolvedTrueType?: ts.Type;
      resolvedFalseType?: ts.Type;
    };
    if (cond.checkType) walk(cond.checkType, d + 1);
    if (cond.extendsType) walk(cond.extendsType, d + 1);
    if (cond.resolvedTrueType) walk(cond.resolvedTrueType, d + 1);
    if (cond.resolvedFalseType) walk(cond.resolvedFalseType, d + 1);

    // Indexed access types: walk the object + index operands.
    const idx = t as ts.Type & {
      objectType?: ts.Type;
      indexType?: ts.Type;
    };
    if (idx.objectType) walk(idx.objectType, d + 1);
    if (idx.indexType) walk(idx.indexType, d + 1);

    // Substitution types (constraint refinements like `T extends string`):
    // walk the base.
    const sub = t as ts.Type & { baseType?: ts.Type };
    if (sub.baseType) walk(sub.baseType, d + 1);

    // Object types: properties + call/construct signatures + index info.
    // Skip drilling into library types — they pull in tons of prototype
    // methods that drown out user signals. Their type arguments are still
    // walked above (e.g. for Array<string>, we count Array once + walk
    // string).
    const flags = t.getFlags();
    // For class/interface instantiations, walk the body only once across
    // all instantiations. `target` identifies the underlying declaration —
    // every `Pipeline<A,B,C>` shares the same target Pipeline class type.
    const target = (t as ts.TypeReference).target;
    const targetId =
      target ? (target as ts.Type & { id?: number }).id : undefined;
    if (typeof targetId === "number") {
      if (walkedClassBodies.has(targetId)) return;
      walkedClassBodies.add(targetId);
    }
    if (flags & ts.TypeFlags.Object && !library) {
      for (const prop of t.getProperties()) {
        try {
          const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
          walk(propType, d + 1);
        } catch {
          // Some symbols throw when their type isn't available here.
        }
        if (walkLimited) return;
      }
      for (const sig of t.getCallSignatures()) {
        for (const p of sig.getParameters()) {
          try {
            walk(checker.getTypeOfSymbolAtLocation(p, decl), d + 1);
          } catch {
            // ignore — same as above.
          }
          if (walkLimited) return;
        }
        try {
          walk(checker.getReturnTypeOfSignature(sig), d + 1);
        } catch {
          // ignore.
        }
        const tps = sig.getTypeParameters();
        if (tps) for (const tp of tps) walk(tp, d + 1);
      }
      for (const sig of t.getConstructSignatures()) {
        try {
          walk(checker.getReturnTypeOfSignature(sig), d + 1);
        } catch {
          // ignore.
        }
      }
      const numIndex = t.getNumberIndexType();
      if (numIndex) walk(numIndex, d + 1);
      const strIndex = t.getStringIndexType();
      if (strIndex) walk(strIndex, d + 1);
    }
  };

  try {
    walk(type, 0);
  } catch {
    walkLimited = true;
  }

  const chain = buildInitializerChain(checker, decl, depthIndex);

  // Symbol-level max depth comes from the trace, not the walk: the deepest the
  // checker recursed across the declaration's Call/New steps. The outermost
  // chain step's subtree peak is the whole initializer's peak, so the max over
  // steps is the symbol's peak. Absent when no step carried a trace record.
  let depth: number | undefined;
  let tail: number | undefined;
  let count: number | undefined;
  if (chain) {
    for (const step of chain) {
      if (step.maxDepth !== undefined) {
        depth =
          depth === undefined ? step.maxDepth : Math.max(depth, step.maxDepth);
      }
      if (step.maxTail !== undefined) {
        tail = tail === undefined ? step.maxTail : Math.max(tail, step.maxTail);
      }
      if (step.maxCount !== undefined) {
        count =
          count === undefined ? step.maxCount : Math.max(count, step.maxCount);
      }
    }
  }

  return {
    display,
    truncated,
    ...(depth !== undefined && { depth }),
    hitDepthLimit: depth !== undefined && depth >= DEPTH_CEILING,
    ...(tail !== undefined && { tail }),
    hitTailLimit: tail !== undefined && tail >= TAIL_CEILING,
    ...(count !== undefined && { count }),
    hitCountLimit: count !== undefined && count >= COUNT_CEILING,
    errored,
    walkLimited,
    uniqueTypes: seen.size,
    referencedNames: Array.from(nameTally.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    ...(chain && chain.length > 0 && { chain }),
  };
}

function loadProgram(): ts.Program {
  // Parse the requested tsconfig plus every project it references. tsc's
  // own createProgram doesn't follow `references` (that's a build-mode
  // concern), so a root tsconfig like
  //   { include: [...], references: [...] }
  // would otherwise only surface its direct `include`s. We union the
  // fileNames across the root + each referenced project so the picker
  // covers the whole workspace.
  const visited = new Set<string>();
  let rootOptions: ts.CompilerOptions | undefined;
  const allFiles = new Set<string>();

  const parse = (path: string): void => {
    const abs = resolve(path);
    if (visited.has(abs)) return;
    visited.add(abs);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      abs,
      {},
      {
        ...ts.sys,
        getCurrentDirectory: () => dirname(abs),
        onUnRecoverableConfigFileDiagnostic: (d) => {
          console.error(`tsconfig parse error in ${abs}:`, d.messageText);
          process.exit(2);
        },
      }
    );
    if (!parsed) {
      console.error(`failed to parse tsconfig at ${abs}`);
      process.exit(2);
    }
    if (!rootOptions) rootOptions = parsed.options;
    for (const f of parsed.fileNames) allFiles.add(f);
    for (const ref of parsed.projectReferences ?? []) {
      // Reference paths can point at a directory (resolved to its
      // tsconfig.json) or directly at a config file.
      let refPath = resolve(dirname(abs), ref.path);
      try {
        if (ts.sys.directoryExists(refPath)) {
          refPath = join(refPath, "tsconfig.json");
        }
      } catch {
        // ignore
      }
      parse(refPath);
    }
  };
  parse(tsconfigPath);

  return ts.createProgram(Array.from(allFiles), rootOptions ?? {});
}

function declarationInfo(
  node: ts.Node
): { kind: SymbolKind; name: string } | null {
  if (ts.isTypeAliasDeclaration(node)) {
    return { kind: "type", name: node.name.text };
  }
  if (ts.isInterfaceDeclaration(node)) {
    return { kind: "interface", name: node.name.text };
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return { kind: "class", name: node.name.text };
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    return { kind: "function", name: node.name.text };
  }
  return null;
}

function variableKind(node: ts.VariableStatement): SymbolKind {
  const flags = node.declarationList.flags;
  if (flags & ts.NodeFlags.Const) return "const";
  if (flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function collectTypeReferences(
  sf: ts.SourceFile,
  root: ts.Node
): SymbolReference[] {
  const refs: SymbolReference[] = [];
  function walk(n: ts.Node): void {
    if (ts.isTypeReferenceNode(n)) {
      let head: ts.Identifier | undefined;
      let cur: ts.EntityName | undefined = n.typeName;
      while (cur && !head) {
        if (ts.isIdentifier(cur)) head = cur;
        else if (ts.isQualifiedName(cur)) cur = cur.left;
        else break;
      }
      if (head) {
        const { line } = sf.getLineAndCharacterOfPosition(head.getStart(sf));
        refs.push({ name: head.text, line: line + 1 });
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(root);
  return refs;
}

function scanProject(depthIndex: DepthIndex): {
  byFile: Map<string, ScannedSymbol[]>;
  sources: Record<string, string>;
  caseMap: Map<string, string>;
} {
  console.log("Walking project AST...");
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const byFile = new Map<string, ScannedSymbol[]>();
  const sources: Record<string, string> = {};
  const caseMap = new Map<string, string>();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const file = relative(REPO_ROOT, sf.fileName);
    if (file.includes("node_modules") || file.startsWith("..")) continue;
    caseMap.set(file.toLowerCase(), file);
    sources[file] = sf.text;

    const entries: ScannedSymbol[] = [];

    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        const kind = variableKind(stmt);
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const startPos = decl.getStart(sf);
          const endPos = decl.getEnd();
          const startLine = sf.getLineAndCharacterOfPosition(startPos).line + 1;
          const endLine = sf.getLineAndCharacterOfPosition(endPos).line + 1;
          const inferred = computeInferredType(checker, decl, depthIndex);
          entries.push({
            name: decl.name.text,
            kind,
            file,
            startLine,
            endLine,
            startPos,
            endPos,
            references: collectTypeReferences(sf, decl),
            inferred,
          });
        }
        continue;
      }
      const info = declarationInfo(stmt);
      if (!info) continue;
      const startPos = stmt.getStart(sf);
      const endPos = stmt.getEnd();
      const startLine = sf.getLineAndCharacterOfPosition(startPos).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(endPos).line + 1;
      entries.push({
        name: info.name,
        kind: info.kind,
        file,
        startLine,
        endLine,
        startPos,
        endPos,
        references: collectTypeReferences(sf, stmt),
      });
    }

    entries.sort((a, b) => a.startLine - b.startLine);
    byFile.set(file, entries);
  }
  return { byFile, sources, caseMap };
}

// ---------------------------------------------------------------------------
// Per-symbol aggregation from types.json
// ---------------------------------------------------------------------------

function flagBucket(flags: string[] | undefined): string {
  if (!flags || flags.length === 0) return "Unknown";
  // The first flag in `flags[]` is the primary type kind; the rest are
  // modifiers (e.g. `Conditional, IncludesEmptyObject`).
  return flags[0]!;
}

function aggregatePerSymbol(
  rawTypes: RawTypeEntry[],
  byFile: Map<string, ScannedSymbol[]>,
  caseMap: Map<string, string>
): {
  index: Record<string, SymbolStats[]>;
  totals: { totalEntries: number; ownedEntries: number; totalSymbols: number };
} {
  console.log("Attributing registry entries to symbols...");
  // Per file, sort entries by start line for efficient range matching.
  type LocatedEntry = {
    file: string;
    line: number;
    endLine: number;
    flag: string;
  };
  const entriesByFile = new Map<string, LocatedEntry[]>();
  let ownedEntries = 0;
  for (const e of rawTypes) {
    if (!e.firstDeclaration) continue;
    const file = normalizeTracePath(e.firstDeclaration.path, caseMap);
    if (!file) continue;
    const line = e.firstDeclaration.start.line + 1;
    const endLine = e.firstDeclaration.end.line + 1;
    const bucket = entriesByFile.get(file) ?? [];
    bucket.push({ file, line, endLine, flag: flagBucket(e.flags) });
    entriesByFile.set(file, bucket);
    ownedEntries += 1;
  }
  for (const list of entriesByFile.values()) {
    list.sort((a, b) => a.line - b.line);
  }

  // Project-wide call-sites map: head name → total TypeReferences pointing at
  // it. Used to fill SymbolStats.callSites for type/interface symbols.
  const callSiteMap = new Map<string, number>();
  for (const symbols of byFile.values()) {
    for (const s of symbols) {
      for (const r of s.references) {
        callSiteMap.set(r.name, (callSiteMap.get(r.name) ?? 0) + 1);
      }
    }
  }

  const out: Record<string, SymbolStats[]> = {};
  let totalSymbols = 0;
  for (const [file, symbols] of byFile) {
    if (symbols.length === 0) continue;
    const fileEntries = entriesByFile.get(file) ?? [];
    const stats: SymbolStats[] = symbols.map((s) => {
      // Filter raw entries whose firstDeclaration range overlaps the symbol.
      // Interval overlap (not containment) — firstDeclaration.pos sits on
      // leading trivia (JSDoc, blank lines), so a type often starts before
      // the AST's `getStart()` line.
      const owned = fileEntries.filter(
        (e) => e.endLine >= s.startLine && e.line <= s.endLine
      );
      const entriesByKind: Record<string, number> = {};
      for (const e of owned) {
        entriesByKind[e.flag] = (entriesByKind[e.flag] ?? 0) + 1;
      }
      return {
        name: s.name,
        kind: s.kind,
        file: s.file,
        startLine: s.startLine,
        endLine: s.endLine,
        startPos: s.startPos,
        endPos: s.endPos,
        references: s.references,
        entriesCreated: owned.length,
        entriesByKind,
        callSites:
          s.kind === "type" || s.kind === "interface" || s.kind === "class" ?
            (callSiteMap.get(s.name) ?? 0)
          : 0,
        ...(s.inferred && { inferred: s.inferred }),
      };
    });
    out[file] = stats;
    totalSymbols += stats.length;
  }

  return {
    index: out,
    totals: {
      totalEntries: rawTypes.length,
      ownedEntries,
      totalSymbols,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main(): void {
  mkdirSync(DATA_DIR, { recursive: true });

  const traceDir = generateTrace();
  const depthIndex = parseDepthSteps(traceDir);
  console.log(`Indexed ${depthIndex.size} per-node depth records from trace.`);
  const { byFile, sources, caseMap } = scanProject(depthIndex);
  const raw = parseJsonArray<RawTypeEntry>(join(traceDir, "types.json"));
  const { index, totals } = aggregatePerSymbol(raw, byFile, caseMap);

  writeFileSync(join(DATA_DIR, "index.json"), JSON.stringify(index));
  writeFileSync(join(DATA_DIR, "sources.json"), JSON.stringify(sources));

  const meta = {
    project: relative(REPO_ROOT, tsconfigPath),
    generatedAt: new Date().toISOString(),
    totalEntries: totals.totalEntries,
    ownedEntries: totals.ownedEntries,
    totalSymbols: totals.totalSymbols,
    ceilings: {
      instantiationDepth: 100,
      instantiationCount: 5_000_000,
      tailCount: 1_000,
    },
  };
  writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  // Legacy files from the old wall-clock model — clean up if still present.
  for (const f of ["types.json", "expressions.json"]) {
    rmSync(join(DATA_DIR, f), { force: true });
  }

  console.log("");
  console.log(
    `Wrote ${totals.totalSymbols} symbols across ${Object.keys(index).length} files. ` +
      `${totals.ownedEntries.toLocaleString()} of ${totals.totalEntries.toLocaleString()} ` +
      `registry entries are owned by project source.`
  );
  console.log(`Output: ${relative(REPO_ROOT, DATA_DIR)}/`);
  console.log(`Trace files preserved at ${traceDir}`);
}

// Only run the build when executed directly (`bun run build.ts`), not when
// imported — so tests can import pure helpers like `indexDepthSteps` without
// triggering a full trace + project scan.
if (import.meta.main) main();
