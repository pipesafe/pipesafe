/**
 * patch-tsc — procedurally augment the bundled TypeScript compiler so that the
 * `--generateTrace` output carries a deterministic, per-Call/New-expression
 * record of the checker's peak instantiation depth and instantiation count.
 *
 * Why this exists
 * ---------------
 * The depth-viewer is for debugging TS2589 ("Type instantiation is excessively
 * deep"). What matters for TS2589 is how deep the checker recurses while
 * *producing* a type — `instantiationDepth` (ceiling 100) — and how much work it
 * does — `instantiationCount` / `totalInstantiationCount` (ceiling 5,000,000).
 *
 * TS2589 actually has three triggers: `instantiationDepth === 100`,
 * `instantiationCount >= 5_000_000` (both in `instantiateTypeWithAlias`), and
 * `tailCount === 1000` (tail-recursive conditional-type elaboration, in
 * `getConditionalType`). The tail-count limit fires with LOW instantiation
 * depth, so it's a genuinely distinct failure mode — we capture its peak too.
 *
 * Stock tsc only records these on the rare `*_DepthLimit` bail events, and the
 * per-span `checkExpression` events that carry source ranges are written via a
 * 10ms wall-clock SAMPLER — so on a healthy run most spans never appear, and on
 * any run the set of spans is machine-dependent. The depth counter is also
 * balanced (it returns to its entry value by the time a span closes), so even a
 * span that *is* sampled reports 0 depth, not the peak it reached mid-flight.
 *
 * We therefore capture the peaks ourselves and emit them deterministically.
 *
 * How
 * ---
 * Everything we need lives in one lexical scope: `instantiationDepth`,
 * `totalInstantiationCount`, `checkExpression` (which already brackets every
 * expression with a tracing push/pop and knows the node's source range),
 * `instantiateTypeWithAlias` (the single site that increments
 * `instantiationDepth`) and `getConditionalType` (the single site that
 * increments `tailCount`) are all inside `createTypeChecker`. So we:
 *   1. declare span/self peak accumulators for depth and tail next to the
 *      instantiation counters,
 *   2. update the depth peaks at the one `instantiationDepth++` site and the
 *      tail peaks at the one `tailCount++` site (exact peaks, not sampled),
 *   3. snapshot + reset them at each `checkExpression` entry (so each node
 *      measures its own window), and
 *   4. at `checkExpression` exit emit a `depthStep` instant — via the tracing
 *      `instant` ("I") path, which is NOT gated by the X-span sampler — for
 *      Call/New nodes that actually instantiated, carrying the node's source
 *      range and its depth/tail/count stats.
 *
 * Because the records flow through `instant` (always written) rather than
 * `writeStackEvent` (sampled), and the values come from monotonic/peak counters
 * rather than timestamps, the same input yields byte-identical `depthStep`
 * payloads run to run. See {@link EDITS}.
 *
 * The edits are applied with magic-string against unique, stable source
 * anchors, each asserted to occur EXACTLY ONCE. If a future TypeScript bump
 * moves or reshapes an anchor, patching throws loudly (naming the anchor)
 * instead of silently mis-patching. node_modules is never mutated — the patched
 * bundle is written to a hash-keyed cache file and run as a child process.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import MagicString from "magic-string";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

/**
 * Bump when the patch logic below changes so previously-cached bundles are
 * invalidated even when the underlying _tsc.js is byte-identical.
 */
export const PATCH_VERSION = 5;

/** Injected into the source so a patched bundle is recognisable + idempotent. */
export const MARKER = "/*__DEPTH_PATCH__*/";

/**
 * Event name for the deterministic per-node records the patch emits. One per
 * Call/New expression that did instantiation work, written via the tracing
 * `instant` (`"I"`) path — which bypasses the 10ms X-span sampling entirely, so
 * the records are reproducible across runs. See {@link EDITS} for the fields.
 */
export const DEPTH_STEP_EVENT = "depthStep";

interface Edit {
  /** Human-readable id used in assertions, errors, and the `matched` map. */
  name: string;
  /** Verbatim source slice that must occur exactly once. */
  anchor: string;
  /** "replace" overwrites the anchor; "after" inserts immediately after it. */
  mode: "replace" | "after";
  /** Replacement text (replace) or inserted text (after). */
  text: string;
}

/**
 * The patch, expressed as anchored edits. Order is irrelevant — every anchor is
 * located against the ORIGINAL source, so edits never shift each other's match.
 *
 * The edits cooperate to capture, for every Call/New expression, the peak of
 * ALL THREE counters TypeScript guards to raise TS2589 —
 * *deterministically*, with no dependence on the wall-clock sampling that gates
 * X-span events:
 *
 *   - `instantiationDepth` — recursive instantiation nesting (ceiling 100).
 *   - `instantiationCount`  — instantiations within one check unit (ceiling
 *                            5,000,000); when a single step's resolution does
 *                            millions of instantiations it collapses the whole
 *                            accumulated type to the error type (`any`). We
 *                            attribute these as a per-node SELF count (work done
 *                            while the node is innermost) so the spike lands on
 *                            the responsible step, not every later step that
 *                            merely contains it.
 *   - `tailCount`          — tail-recursive conditional-type elaboration steps
 *                            (ceiling 1000); fires with low instantiation depth,
 *                            so it's a distinct failure mode worth its own peak.
 *
 * We also bracket the monotonic `totalInstantiationCount` so a consumer can take
 * a node's whole-subtree instantiation delta (enter→exit, from one pass).
 *
 *   1. `depth-counters`  — `var`s in the `createTypeChecker` closure tracking
 *                          running span/self peaks for depth + tail and a self
 *                          counter for instantiations.
 *   2. `depth-hook`      — at the single `instantiationDepth++` site (inside
 *                          `instantiateTypeWithAlias`), fold the new depth into
 *                          its peaks and tally one instantiation against the
 *                          current frame's self count. A few ops per instantiation.
 *   3. `tail-hook`       — at the single `tailCount++` site (inside
 *                          `getConditionalType`), fold the new tail count in.
 *   4. `checkexpr-enter` — at the top of `checkExpression`, snapshot the parent
 *                          frame's peaks + self-count + entry counters and reset
 *                          the per-node accumulators (depth to the ambient depth;
 *                          tail + self-count to 0) so each node measures its own
 *                          window.
 *   5. `checkexpr-exit`  — at the bottom of `checkExpression`, read back the
 *                          node's peaks + self-count, restore the parent's
 *                          accumulators (span peaks propagate up via max; self
 *                          peaks and self-count do NOT), and — for Call/New nodes
 *                          that actually instantiated — emit a `depthStep` instant
 *                          carrying the node's source range plus its stats.
 *
 * `spanPeak*` is the max over the node's whole subtree. `selfPeak*`/`selfCount`
 * are reset on EVERY nested `checkExpression` (not only Call/New), so they
 * capture only what happens in windows where this node is the innermost active
 * expression — this node's own signature/return resolution, excluding all nested
 * expression children. The depth/tail peaks are absolute `instantiationDepth`/
 * `tailCount` values; `enterDepth` gives the ambient depth so a consumer can
 * subtract it. `enterTotalCount`/`exitTotalCount` bracket the monotonic
 * `totalInstantiationCount` for a single-pass whole-subtree delta.
 */
const EDITS: Edit[] = [
  // 1. Peak accumulators in the createTypeChecker closure, declared right after
  //    the instantiation counters they shadow. `__dvSpan*` survive across nested
  //    checkExpression frames (each frame saves/restores them); `__dvSelf*` are
  //    reset per frame and not propagated up.
  {
    name: "depth-counters",
    anchor: "var instantiationDepth = 0;",
    mode: "after",
    text: `\n  ${MARKER} var __dvSpanPeak = 0, __dvSelfPeak = 0, __dvTailSpan = 0, __dvTailSelf = 0, __dvSelfCount = 0;`,
  },

  // 2. The single instantiation site (in instantiateTypeWithAlias). Fold the
  //    freshly-incremented depth into both depth peaks, and tally one
  //    instantiation against the current innermost frame's SELF count — the
  //    marginal work this node does, so it spikes at the responsible step
  //    instead of being inherited by every later (containing) step. Cheap and
  //    runs on every instantiation, so the values are exact, not sampled.
  {
    name: "depth-hook",
    anchor:
      "totalInstantiationCount++;\n    instantiationCount++;\n    instantiationDepth++;",
    mode: "after",
    text: ` ${MARKER} if (instantiationDepth > __dvSpanPeak) __dvSpanPeak = instantiationDepth; if (instantiationDepth > __dvSelfPeak) __dvSelfPeak = instantiationDepth; __dvSelfCount++;`,
  },

  // 3. The single tail-recursion-count increment site (in getConditionalType).
  //    Fold the new tailCount into both running tail peaks, same as depth.
  {
    name: "tail-hook",
    anchor: "tailCount++;",
    mode: "after",
    text: ` ${MARKER} if (tailCount > __dvTailSpan) __dvTailSpan = tailCount; if (tailCount > __dvTailSelf) __dvTailSelf = tailCount;`,
  },

  // 4. checkExpression entry: snapshot the parent frame's peaks + self-count +
  //    entry depth/count, then reset the per-node accumulators (depth to the
  //    ambient depth so a nested node's window starts at its real baseline; tail
  //    to 0 since tailCount is a per-conditional-resolution local; self-count to
  //    0 so it tallies only THIS node's own instantiations).
  {
    name: "checkexpr-enter",
    anchor:
      '(_a = tracing) == null ? void 0 : _a.push(tracing.Phase.Check, "checkExpression", { kind: node.kind, pos: node.pos, end: node.end, path: node.tracingPath });\n    const saveCurrentNode = currentNode;',
    mode: "replace",
    text:
      '(_a = tracing) == null ? void 0 : _a.push(tracing.Phase.Check, "checkExpression", { kind: node.kind, pos: node.pos, end: node.end, path: node.tracingPath });\n' +
      `    ${MARKER} const __dvSaveSpan = __dvSpanPeak, __dvSaveSelf = __dvSelfPeak, __dvSaveTailSpan = __dvTailSpan, __dvSaveTailSelf = __dvTailSelf, __dvSaveSelfCount = __dvSelfCount, __dvEnterTotal = totalInstantiationCount, __dvEnterDepth = instantiationDepth; __dvSpanPeak = instantiationDepth; __dvSelfPeak = instantiationDepth; __dvTailSpan = 0; __dvTailSelf = 0; __dvSelfCount = 0;\n` +
      "    const saveCurrentNode = currentNode;",
  },

  // 5. checkExpression exit: capture this node's peaks + self-count, propagate
  //    the span PEAKS up to the parent (but not the self peaks), restore the
  //    self-count to the parent's accumulator (so the child's instantiations are
  //    NOT folded into the parent's self-count — each frame's self-count is its
  //    own marginal), and for Call/New nodes that did real work emit a
  //    deterministic `depthStep` instant. Node kinds: 214 = CallExpression,
  //    215 = NewExpression (TS 5.9 SyntaxKind).
  {
    name: "checkexpr-exit",
    anchor:
      "currentNode = saveCurrentNode;\n    (_b = tracing) == null ? void 0 : _b.pop();\n    return type;",
    mode: "replace",
    text:
      "currentNode = saveCurrentNode;\n" +
      `    ${MARKER} { const __dvNodeSpan = __dvSpanPeak, __dvNodeSelf = __dvSelfPeak, __dvNodeTailSpan = __dvTailSpan, __dvNodeTailSelf = __dvTailSelf, __dvNodeSelfCount = __dvSelfCount; __dvSpanPeak = __dvSaveSpan > __dvNodeSpan ? __dvSaveSpan : __dvNodeSpan; __dvSelfPeak = __dvSaveSelf; __dvTailSpan = __dvSaveTailSpan > __dvNodeTailSpan ? __dvSaveTailSpan : __dvNodeTailSpan; __dvTailSelf = __dvSaveTailSelf; __dvSelfCount = __dvSaveSelfCount; if (tracing && (node.kind === 214 || node.kind === 215) && (totalInstantiationCount > __dvEnterTotal || __dvNodeSpan > __dvEnterDepth)) { tracing.instant(tracing.Phase.Check, ${JSON.stringify(DEPTH_STEP_EVENT)}, { kind: node.kind, pos: node.pos, end: node.end, path: node.tracingPath, enterDepth: __dvEnterDepth, spanPeakDepth: __dvNodeSpan, selfPeakDepth: __dvNodeSelf, spanPeakTail: __dvNodeTailSpan, selfPeakTail: __dvNodeTailSelf, selfCount: __dvNodeSelfCount, enterTotalCount: __dvEnterTotal, exitTotalCount: totalInstantiationCount }); } }\n` +
      "    (_b = tracing) == null ? void 0 : _b.pop();\n    return type;",
  },
];

/** Thrown when an anchor doesn't occur exactly once. */
export class AnchorError extends Error {
  constructor(
    readonly editName: string,
    readonly anchor: string,
    readonly count: number
  ) {
    super(
      `patch-tsc: anchor for edit "${editName}" matched ${count} time(s), expected exactly 1. ` +
        `The bundled TypeScript likely changed shape (re-check _tsc.js for: ${JSON.stringify(
          anchor.length > 80 ? anchor.slice(0, 80) + "…" : anchor
        )}).`
    );
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}

export interface PatchResult {
  /** The patched source. */
  code: string;
  /** Per-edit match counts (each is 1 on success). Empty when already patched. */
  matched: Record<string, number>;
  /** True when the input already carried the marker (no work done). */
  alreadyPatched: boolean;
}

/**
 * Apply the depth-stats patch to _tsc.js source text. Pure (no I/O). Throws
 * {@link AnchorError} if any anchor is missing or ambiguous. Idempotent: a
 * source that already contains {@link MARKER} is returned unchanged.
 */
export function patchTscSource(src: string): PatchResult {
  if (src.includes(MARKER)) {
    return { code: src, matched: {}, alreadyPatched: true };
  }

  const matched: Record<string, number> = {};
  const ms = new MagicString(src);

  for (const edit of EDITS) {
    const count = countOccurrences(src, edit.anchor);
    if (count !== 1) throw new AnchorError(edit.name, edit.anchor, count);
    matched[edit.name] = count;

    const start = src.indexOf(edit.anchor);
    const end = start + edit.anchor.length;
    if (edit.mode === "replace") {
      ms.overwrite(start, end, edit.text);
    } else {
      ms.appendLeft(end, edit.text);
    }
  }

  return { code: ms.toString(), matched, alreadyPatched: false };
}

/** Names of every edit the patch applies — handy for tests. */
export const EDIT_NAMES: readonly string[] = EDITS.map((e) => e.name);

export interface MaterializeOptions {
  /** Repo root containing node_modules. Defaults to the monorepo root. */
  repoRoot?: string;
  /** Directory for cached patched bundles. Defaults to `<here>/.cache`. */
  cacheDir?: string;
}

export interface MaterializeResult {
  /** Absolute path to the patched, runnable bundle (a .cjs file). */
  path: string;
  /** Absolute path to the stock _tsc.js it was derived from. */
  sourcePath: string;
  /** True when an existing cache entry was reused. */
  cached: boolean;
}

/** Locate the stock compiler bundle the `tsc` bin executes. */
export function resolveStockTsc(repoRoot: string = REPO_ROOT): string {
  const p = resolve(repoRoot, "node_modules/typescript/lib/_tsc.js");
  if (!existsSync(p)) {
    throw new Error(
      `patch-tsc: stock compiler not found at ${p}. Run 'bun install'.`
    );
  }
  return p;
}

/**
 * Produce a patched, runnable copy of _tsc.js and return its path. The result
 * is cached under a key derived from the stock source hash + {@link
 * PATCH_VERSION}, so repeat builds reuse it and a TypeScript upgrade or a patch
 * change forces a rebuild. node_modules is never written to.
 *
 * The output uses a `.cjs` extension so Node runs it as CommonJS regardless of
 * the surrounding package's `"type": "module"`. Because tsc locates its bundled
 * `lib.*.d.ts` files relative to the executing script's directory, we also
 * symlink the stock lib declaration files next to the patched bundle (see
 * {@link linkDefaultLibs}) so default-lib resolution works from the cache dir.
 */
export function materializePatchedTsc(
  opts: MaterializeOptions = {}
): MaterializeResult {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const sourcePath = resolveStockTsc(repoRoot);
  const src = readFileSync(sourcePath, "utf8");
  const srcHash = createHash("sha256").update(src).digest("hex").slice(0, 16);

  const cacheDir = opts.cacheDir ?? resolve(HERE, ".cache");
  const outPath = join(cacheDir, `_tsc.depth.${srcHash}.v${PATCH_VERSION}.cjs`);

  mkdirSync(cacheDir, { recursive: true });
  // Always (cheaply) ensure the lib symlinks exist — they may be missing even
  // on a cache hit (e.g. cleared independently, or a prior partial run).
  linkDefaultLibs(dirname(sourcePath), cacheDir);

  if (existsSync(outPath)) {
    return { path: outPath, sourcePath, cached: true };
  }

  const { code } = patchTscSource(src);
  writeFileSync(outPath, code);
  return { path: outPath, sourcePath, cached: false };
}

/**
 * Symlink every `lib*.d.ts` from the stock TypeScript lib dir into `destDir`,
 * so a patched bundle running from `destDir` resolves the default libs exactly
 * as stock tsc would (tsc derives the default-lib location from the directory
 * of the executing file). Idempotent; existing links are left as-is.
 */
function linkDefaultLibs(stockLibDir: string, destDir: string): void {
  for (const name of readdirSync(stockLibDir)) {
    if (!name.startsWith("lib") || !name.endsWith(".d.ts")) continue;
    const link = join(destDir, name);
    if (existsSync(link)) continue;
    try {
      symlinkSync(join(stockLibDir, name), link);
    } catch (err) {
      // Tolerate races (EEXIST) where a concurrent run created the link first.
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
  }
}
