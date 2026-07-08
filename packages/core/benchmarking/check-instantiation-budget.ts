#!/usr/bin/env bun
/**
 * CI instantiation-budget gate (plan §7.1 item 2).
 *
 * Whole-project type-instantiation count is the only automatic enforcement
 * the operator-key dispatch standard (§3.4) can have: the assertion files
 * pin SEMANTICS, but a reintroduced full-union membership test on a hot
 * path keeps every assertion green while costing +8% instantiations
 * (measured during the PR #102 review). This script fails CI when the
 * count exceeds the budget in instantiation-budget.json.
 *
 * Requires a fresh `bun run build` first: tsconfig.benchmark.json includes
 * the examples, which resolve @pipesafe/core to dist.
 *
 * Run: bun run benchmarking/check-instantiation-budget.ts
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import process from "node:process";
import { clearTSCache, parseExtendedDiagnostics } from "./benchmark";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const budgetFile = join(
  PACKAGE_ROOT,
  "benchmarking",
  "instantiation-budget.json"
);
const budget = JSON.parse(readFileSync(budgetFile, "utf-8")) as {
  maxInstantiations: number;
  lastMeasured: number;
};

// Same cache hygiene as the benchmark suite — one shared implementation so
// the CI gate and the suite always measure the same configuration.
clearTSCache();

let output: string;
try {
  output = execSync(
    "npx tsc --noEmit --project tsconfig.benchmark.json --extendedDiagnostics 2>&1",
    { encoding: "utf-8", cwd: PACKAGE_ROOT, maxBuffer: 10 * 1024 * 1024 }
  );
} catch (error) {
  const err = error as { stdout?: unknown; message?: string };
  output = err.stdout?.toString() ?? err.message ?? "";
  const compileErrors = output.split("\n").filter((l) => /error TS\d+/.test(l));
  if (compileErrors.length > 0) {
    console.error(
      "❌ tsconfig.benchmark.json does not type-check — fix these before the budget is meaningful:"
    );
    console.error(compileErrors.slice(0, 10).join("\n"));
    process.exit(1);
  }
}

const { typeInstantiations } = parseExtendedDiagnostics(output);
if (typeInstantiations === undefined) {
  console.error("❌ Could not parse an instantiation count from tsc output.");
  process.exit(1);
}

const pct = ((typeInstantiations / budget.maxInstantiations) * 100).toFixed(1);
console.log(
  `Type instantiations: ${typeInstantiations.toLocaleString()} ` +
    `(budget ${budget.maxInstantiations.toLocaleString()}, ${pct}% used; ` +
    `last measured ${budget.lastMeasured.toLocaleString()})`
);

if (typeInstantiations > budget.maxInstantiations) {
  console.error(
    `\n❌ Instantiation budget exceeded by ${(
      typeInstantiations - budget.maxInstantiations
    ).toLocaleString()}.\n` +
      "Investigate the regression before raising the budget — see " +
      "benchmarking/instantiation-budget.json for the update policy."
  );
  process.exit(1);
}

console.log("✅ Within budget.");
