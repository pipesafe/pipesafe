#!/usr/bin/env bun
/**
 * Generator for deliberately pathological pipelines, used only to demonstrate
 * the depth-viewer surfacing TypeScript's three TS2589 ceilings. NOT part of the
 * shipped library — written to examples/, viewed, then deleted.
 *
 * Emits three pipelines into `_stress-pipelines.ts`, each dominated by ONE
 * stressor (as far as pipesafe allows — see the tail note):
 *
 *   - depthStressPipeline — instantiation DEPTH → 100. A long `.set()` chain
 *     whose accumulated document type grows each step. Keys are shallow (NEST
 *     levels, well under pipesafe's intentional ~10-segment dotted limit) so the
 *     depth comes from chain accumulation, not per-key dotted truncation.
 *
 *   - countStressPipeline — per-unit instantiationCount → 5,000,000 (collapses
 *     the type to `any`). Each stage sets many DISTINCT shallow keys, so the
 *     checker does a huge wide merge with little nesting: count saturates while
 *     depth stays low (~30).
 *
 *   - tailStressPipeline — tail-recursive conditional elaboration (tailCount).
 *     A deep literal-schema field path drives the tail-recursive `GetFieldType`
 *     resolver. NOTE: pipesafe cannot drive tailCount to its 1000 ceiling in
 *     isolation — resolving a deep path also climbs instantiation depth (~4.5x
 *     faster), which caps at 100 first. So this is the most tail-prominent
 *     construct achievable; depth rides along under it.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Tunables -------------------------------------------------------------
const DEPTH_STAGES = Number(process.argv[2] ?? 120); // chain length for depth
const DEPTH_NEST = Number(process.argv[3] ?? 6); // dotted depth per key (< ~10)
const COUNT_STAGES = Number(process.argv[4] ?? 5); // stages for count
const COUNT_WIDTH = Number(process.argv[5] ?? 1500); // distinct keys per stage
// Field-path segments for tail. 22 is the deepest that still resolves: each
// segment adds ~1 tailCount and ~4.5 instantiationDepth, so at 23 depth hits the
// 100 ceiling, the type errors, and tail collapses to 0. 22 → tail 22, depth 99.
const TAIL_PATH = Number(process.argv[6] ?? 22);

// ---------------------------------------------------------------------------

// A shallow dotted key "deep{s}.l0.l1.…l{NEST-1}" — within the dotted limit, so
// it resolves fully; depth comes from accumulating these across the chain.
const deepKey = (s: number): string =>
  "deep" +
  s +
  "." +
  Array.from({ length: DEPTH_NEST }, (_, i) => `l${i}`).join(".");

function depthPipeline(): string[] {
  const lines = [
    "type DepthSchema = { _id: string; base: string; count: number };",
    "",
    "// Each stage sets a (shallow) dotted field plus a flat field that references",
    "// the prior stage's flat field, so the document type is re-resolved and",
    "// grown at every step — driving instantiation DEPTH to the 100 ceiling.",
    "export const depthStressPipeline = new Pipeline<DepthSchema>()",
  ];
  for (let s = 0; s < DEPTH_STAGES; s++) {
    lines.push(
      `  .set({ "${deepKey(s)}": "$base", "flat${s}": ${s === 0 ? '"$base"' : `"$flat${s - 1}"`} })`
    );
  }
  lines[lines.length - 1] += ";";
  return lines;
}

function countPipeline(): string[] {
  const lines = [
    "type CountSchema = { _id: string; base: string };",
    "",
    "// Each stage sets many DISTINCT shallow keys, forcing a huge wide merge with",
    "// little nesting — per-unit instantiationCount saturates at 5,000,000 (which",
    "// collapses the whole type to `any`) while DEPTH stays low.",
    "export const countStressPipeline = new Pipeline<CountSchema>()",
  ];
  for (let s = 0; s < COUNT_STAGES; s++) {
    const fields = Array.from(
      { length: COUNT_WIDTH },
      (_, i) => `"s${s}k${i}.a": "$base"`
    ).join(", ");
    lines.push(`  .set({ ${fields} })`);
  }
  lines[lines.length - 1] += ";";
  return lines;
}

function tailPipeline(): string[] {
  // A schema literally nested TAIL_PATH deep, and a field path that walks it.
  let schema = "{ leaf: number }";
  for (let i = 0; i < TAIL_PATH; i++) schema = `{ l: ${schema} }`;
  const path = Array.from({ length: TAIL_PATH }, () => "l").join(".") + ".leaf";
  return [
    `type TailSchema = { _id: string } & ${schema};`,
    "",
    "// A deep literal field path drives the tail-recursive `GetFieldType` resolver",
    "// (tailCount). pipesafe can't isolate this from depth: each path segment adds",
    "// ~1 tailCount but ~4.5 instantiationDepth, so depth reaches ~99 here and one",
    "// segment deeper would trip the 100 depth ceiling (erroring before tail grows",
    "// further). So tail tops out around 22 — the deepest tailCount achievable.",
    `export const tailStressPipeline = new Pipeline<TailSchema>().match({ "${path}": 5 });`,
  ];
}

const out = [
  "// AUTO-GENERATED stress pipelines — safe to delete.",
  'import { Pipeline } from "@pipesafe/core";',
  "",
  ...depthPipeline(),
  "",
  ...countPipeline(),
  "",
  ...tailPipeline(),
  "",
].join("\n");

const dest = resolve(
  import.meta.dir,
  "../packages/core/examples/_stress-pipelines.ts"
);
writeFileSync(dest, out);
console.log(
  `Wrote ${dest}\n  depth: ${DEPTH_STAGES} stages x nest ${DEPTH_NEST}\n  count: ${COUNT_STAGES} stages x ${COUNT_WIDTH} keys\n  tail:  path depth ${TAIL_PATH}`
);
