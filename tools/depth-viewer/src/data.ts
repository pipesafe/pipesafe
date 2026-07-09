import type { Dataset, Meta, SymbolStats } from "./types";

/**
 * Thrown when the dataset hasn't been built yet. Distinct from a genuine
 * load/parse failure so the UI can show the "build it" empty-state (with the
 * rebuild button) instead of a raw error.
 */
export class DatasetMissingError extends Error {
  constructor() {
    super("No dataset yet — build it to get started.");
    this.name = "DatasetMissingError";
  }
}

export async function loadDataset(): Promise<Dataset> {
  // Vite serves index.html for unknown paths, so a missing JSON asset comes
  // back as 200-with-HTML. Check `ok` AND the content type before parsing —
  // otherwise `r.json()` throws a cryptic "Unexpected token <".
  const missing = (r: Response): boolean =>
    !r.ok || !(r.headers.get("content-type") ?? "").includes("json");

  const [metaRes, indexRes, sourcesRes] = await Promise.all([
    fetch("/data/meta.json"),
    fetch("/data/index.json"),
    fetch("/data/sources.json"),
  ]);

  if (missing(metaRes) || missing(indexRes)) throw new DatasetMissingError();

  const meta = (await metaRes.json()) as Meta;
  const index = (await indexRes.json()) as Record<string, SymbolStats[]>;
  const sources =
    missing(sourcesRes) ?
      {}
    : ((await sourcesRes.json()) as Record<string, string>);

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
