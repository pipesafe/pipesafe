import type { Dataset, Meta, SymbolStats } from "./types";

export async function loadDataset(): Promise<Dataset> {
  const [meta, index, sources] = await Promise.all([
    fetch("/data/meta.json").then((r) => {
      if (!r.ok) throw new Error("meta.json missing — run depth-view:build");
      return r.json() as Promise<Meta>;
    }),
    fetch("/data/index.json").then(
      (r) => r.json() as Promise<Record<string, SymbolStats[]>>
    ),
    fetch("/data/sources.json").then((r) =>
      r.ok ? (r.json() as Promise<Record<string, string>>) : {}
    ),
  ]);
  return { meta, index, sources };
}

export function fmtCount(n: number): string {
  return n.toLocaleString();
}

/**
 * Locate a symbol across the whole project by its name. Used to surface
 * stats for types referenced from another symbol.
 */
export function findSymbolByName(
  index: Record<string, SymbolStats[]>,
  name: string
): SymbolStats | undefined {
  for (const list of Object.values(index)) {
    const hit = list.find((s) => s.name === name);
    if (hit) return hit;
  }
  return undefined;
}
