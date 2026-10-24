import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function findTscBin(): string {
  const local = resolve(REPO_ROOT, "node_modules/.bin/tsc");
  if (!existsSync(local)) {
    console.error(`Local tsc not found at ${local}. Run 'bun install'.`);
    process.exit(2);
  }
  return local;
}

/**
 * Run `tsc --generateTrace` into a freshly emptied `traceDir`. Incrementality
 * is disabled so a composite project's tsbuildinfo can neither short-circuit
 * the check (empty trace) nor be rewritten.
 */
export function runTscTrace(
  command: string,
  baseArgs: string[],
  tsconfigPath: string,
  traceDir: string
): SpawnSyncReturns<string> {
  rmSync(traceDir, { recursive: true, force: true });
  mkdirSync(traceDir, { recursive: true });
  return spawnSync(
    command,
    [
      ...baseArgs,
      "-p",
      tsconfigPath,
      "--noEmit",
      "--generateTrace",
      traceDir,
      "--extendedDiagnostics",
      "--composite",
      "false",
      "--incremental",
      "false",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 }
  );
}

/** Parse a tsc trace JSON array, tolerating a truncated trailing line. */
export function parseJsonArray<T>(path: string): T[] {
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

/** A types.json registry entry (the fields these tools read). */
export interface RawTypeEntry {
  id: number;
  symbolName?: string;
  intrinsicName?: string;
  display?: string;
  flags?: string[];
  recursionId?: number;
  instantiatedType?: number;
  typeArguments?: number[];
  firstDeclaration?: {
    path: string;
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}
