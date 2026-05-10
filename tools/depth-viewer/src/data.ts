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
