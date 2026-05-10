import type {
  AggregatedType,
  Dataset,
  ExpressionCost,
  Meta,
  SymbolEntry,
} from "./types";

export async function loadDataset(): Promise<Dataset> {
  const [meta, types, index, expressions] = await Promise.all([
    fetch("/data/meta.json").then((r) => {
      if (!r.ok) throw new Error("meta.json missing — run depth-view:build");
      return r.json() as Promise<Meta>;
    }),
    fetch("/data/types.json").then(
      (r) => r.json() as Promise<AggregatedType[]>
    ),
    fetch("/data/index.json").then(
      (r) => r.json() as Promise<Record<string, SymbolEntry[]>>
    ),
    fetch("/data/expressions.json").then(
      (r) => r.json() as Promise<Record<string, ExpressionCost[]>>
    ),
  ]);
  return { meta, types, index, expressions };
}

// Sum of expression costs whose char range falls inside the symbol's range.
// Used as the "total cost of this symbol's check" — independent of where the
// types themselves were declared.
export function expressionCostInRange(
  expressions: ExpressionCost[] | undefined,
  startPos: number,
  endPos: number
): { totalUs: number; callCount: number; events: ExpressionCost[] } {
  if (!expressions) return { totalUs: 0, callCount: 0, events: [] };
  const events = expressions.filter(
    (e) => e.pos >= startPos && e.end <= endPos
  );
  let totalUs = 0;
  let callCount = 0;
  for (const e of events) {
    totalUs += e.totalUs;
    callCount += e.callCount;
  }
  return { totalUs, callCount, events };
}

// Types whose firstDeclaration line falls inside the symbol's line range.
// These are the named types the checker created during this symbol's check.
export function typesInRange(
  types: AggregatedType[],
  file: string,
  startLine: number,
  endLine: number
): AggregatedType[] {
  return types.filter(
    (t) =>
      t.file === file &&
      t.line !== undefined &&
      t.line >= startLine &&
      t.line <= endLine
  );
}

export function fmtUs(us: number): string {
  if (us < 1000) return `${us.toFixed(0)}µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString();
}

export function indexById(
  types: AggregatedType[]
): Map<number, AggregatedType> {
  const m = new Map<number, AggregatedType>();
  for (const t of types) m.set(t.id, t);
  return m;
}

export interface LineageStep {
  type: AggregatedType;
  // How many times this type appeared in a flattened cycle. Always 1 for
  // non-cyclic chain entries.
  repeats: number;
}

export interface LineageChain {
  root: AggregatedType;
  steps: LineageStep[];
  truncated: boolean;
}

const MAX_LINEAGE_DEPTH = 200;

// Walk parent (`instantiatedType`) edges upward from `rootId`, detecting
// cycles. When the same typeId is revisited, the cycle is folded into a
// repeats count rather than rendering the full repeated path.
//
// Cycles in `instantiatedType` chains are rare (the edge points concrete ->
// generic, which should be acyclic) but happen for mutually-recursive
// generics. The flattening keeps such chains readable.
export function lineageOf(
  byId: Map<number, AggregatedType>,
  rootId: number
): LineageChain {
  const root = byId.get(rootId);
  if (!root) {
    throw new Error(`Type #${rootId} missing from dataset`);
  }

  const steps: LineageStep[] = [];
  const indexInChain = new Map<number, number>();
  let cur: number | undefined = root.parent;
  let truncated = false;

  while (cur !== undefined) {
    if (steps.length >= MAX_LINEAGE_DEPTH) {
      truncated = true;
      break;
    }
    if (indexInChain.has(cur)) {
      // We've seen this type before. Treat the segment between the previous
      // occurrence and now as one cycle iteration; bump its repeat count.
      const cycleStart = indexInChain.get(cur)!;
      const cycleLen = steps.length - cycleStart;
      const target = steps[cycleStart];
      if (target) target.repeats += 1;
      // Walk forward: peek the next ancestor and see if it also matches the
      // cycle pattern; if so, increment again. Otherwise break.
      let probe: number | undefined = byId.get(cur)?.parent;
      let probeSteps = 0;
      while (probe !== undefined) {
        const expected = steps[cycleStart + (probeSteps % cycleLen)]?.type.id;
        if (expected === undefined || probe !== expected) break;
        if (probeSteps % cycleLen === 0 && probeSteps > 0 && target) {
          target.repeats += 1;
        }
        probe = byId.get(probe)?.parent;
        probeSteps += 1;
      }
      break;
    }

    const t = byId.get(cur);
    if (!t) break;
    indexInChain.set(cur, steps.length);
    steps.push({ type: t, repeats: 1 });
    cur = t.parent;
  }

  return { root, steps, truncated };
}

export interface OwningSymbol {
  file: string;
  symbolName: string;
  symbolKind: SymbolEntry["kind"];
}

// Map a file + line to the smallest enclosing top-level symbol, or null if
// none. Linear scan is fine: per-file lists are small (<200 entries).
export function findOwningSymbol(
  index: Record<string, SymbolEntry[]>,
  file: string,
  line: number
): OwningSymbol | null {
  const list = index[file];
  if (!list) return null;
  let best: SymbolEntry | null = null;
  for (const s of list) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || s.endLine - s.startLine < best.endLine - best.startLine) {
        best = s;
      }
    }
  }
  if (!best) return null;
  return { file, symbolName: best.name, symbolKind: best.kind };
}

export interface ContributorRow {
  key: string;
  file?: string;
  symbolName: string;
  symbolKind?: SymbolEntry["kind"];
  totalUs: number;
  callCount: number;
  typeCount: number;
}

// Roll the lineage of every root type up by their owning symbol, summing
// time across all encountered types. Answers: "of all the types touched while
// checking this symbol, which other source-symbols own them and contribute
// the most?" — independent of the rendered tree depth.
export function topContributors(
  byId: Map<number, AggregatedType>,
  index: Record<string, SymbolEntry[]>,
  rootIds: number[]
): ContributorRow[] {
  const buckets = new Map<string, ContributorRow>();
  const seen = new Set<number>();

  function consume(t: AggregatedType): void {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const owning =
      t.file && t.line !== undefined ?
        findOwningSymbol(index, t.file, t.line)
      : null;
    const key =
      owning ? `${owning.file}:${owning.symbolName}` : (t.file ?? "<external>");
    let row = buckets.get(key);
    if (!row) {
      row = {
        key,
        ...(t.file !== undefined && { file: t.file }),
        symbolName: owning?.symbolName ?? `<${t.file ?? "external"}>`,
        ...(owning?.symbolKind !== undefined && {
          symbolKind: owning.symbolKind,
        }),
        totalUs: 0,
        callCount: 0,
        typeCount: 0,
      };
      buckets.set(key, row);
    }
    row.totalUs += t.totalUs;
    row.callCount += t.callCount;
    row.typeCount += 1;
  }

  for (const rootId of rootIds) {
    const root = byId.get(rootId);
    if (!root) continue;
    consume(root);
    const lineage = lineageOf(byId, rootId);
    for (const step of lineage.steps) consume(step.type);
  }

  return Array.from(buckets.values()).sort((a, b) => b.totalUs - a.totalUs);
}
