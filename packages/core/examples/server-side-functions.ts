#!/usr/bin/env bun
/**
 * Server-Side Function ($function) Examples
 *
 * The `$function` operator runs JavaScript inside MongoDB's isolated JS
 * engine. PipeSafe makes it type-safe:
 *
 * - `body` is a real TypeScript function — `args` determine its parameter
 *   types ("$price" → number). At top-level keys of $set/$project the
 *   params don't even need annotations; wrong annotations or wrong arity
 *   fail to compile at any nesting depth.
 * - The expression's result type is the body's return type (undefined/void
 *   normalize to null — BSON has no undefined).
 * - Bodies must be SELF-CONTAINED: MongoDB can't see your closures or
 *   imports. Violations are flagged in the editor by the
 *   `no-impure-function-body` ESLint rule and thrown at pipeline-build time
 *   by the runtime check.
 * - Bodies that need imports live in their own module via `serverFn()` +
 *   the optional `@pipesafe/function-bundler` package.
 *
 * Enable the ESLint rule in your flat config:
 *
 *   import pipesafe from "@pipesafe/core/eslint-plugin";
 *   export default [
 *     {
 *       plugins: { pipesafe },
 *       rules: { "pipesafe/no-impure-function-body": "error" },
 *     },
 *   ];
 */

import { Pipeline, serverFn } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";
import applyTax from "./server-functions/pricing.server";

// ============================================================================
// Schema
// ============================================================================

type Order = {
  _id: string;
  sku: string;
  price: number;
  quantity: number;
  notes?: string | undefined;
  placedAt: Date;
};

// ============================================================================
// Example 1: Inline body — args type the params, return type flows out
// ============================================================================

const withTotals = new Pipeline<Order>().set({
  // No annotations needed at top-level keys: "$price" and "$quantity" type
  // `price` and `quantity` as number. An explicit annotation is also fine —
  // but a WRONG one (e.g. `price: string`) is a compile error at `body`.
  lineTotal: {
    $function: {
      body: (price, quantity) => price * quantity,
      args: ["$price", "$quantity"],
      lang: "js",
    },
  },
});

type WithTotals = InferOutputType<typeof withTotals>;
// WithTotals["lineTotal"] is number

// ============================================================================
// Example 2: Nested in other operators — correlation holds at any depth
// ============================================================================

// NESTED $function bodies (inside $cond/$add/accumulators) need annotated
// params — there is no inference site for args at arbitrary depth, and an
// unannotated param there is a TS7006 compile error rather than silent any.
const withGrade = new Pipeline<Order>().set({
  grade: {
    $cond: [
      { $gte: ["$price", 100] },
      {
        $function: {
          body: (sku: string) => sku.toUpperCase(),
          args: ["$sku"],
          lang: "js",
        },
      },
      "standard",
    ],
  },
});

type WithGrade = InferOutputType<typeof withGrade>;
// WithGrade["grade"] is string | "standard"

// ============================================================================
// Example 3: Server-side globals are fine; closures are not
// ============================================================================

const withDigest = new Pipeline<Order>().set({
  digest: {
    $function: {
      // Math / JSON / Date / String etc. exist in the server's JS engine
      body: (price, placedAt) =>
        JSON.stringify({ p: Math.round(price), day: placedAt.getUTCDay() }),
      args: ["$price", "$placedAt"],
      lang: "js",
    },
  },
});

// These would NOT compile / lint / build:
//
// const TAX = 1.2;
// new Pipeline<Order>().set({
//   taxed: {
//     $function: {
//       // ✗ lint: references outer-scope variable 'TAX'
//       //   runtime: throws "references variables not defined inside the function: 'TAX'"
//       body: (p: number) => p * TAX,
//       args: ["$price"],
//       lang: "js",
//     },
//   },
// });
//
// new Pipeline<Order>().set({
//   bad: {
//     $function: {
//       // ✗ compile: param annotated string but '$price' resolves to number
//       body: (p: string) => p.length,
//       args: ["$price"],
//       lang: "js",
//     },
//   },
// });
//
// new Pipeline<Order>().set({
//   bad: {
//     $function: {
//       // ✗ compile: `p` is number (typed from '$price') — not a string
//       body: (p) => p.toUpperCase(),
//       args: ["$price"],
//       lang: "js",
//     },
//   },
// });

// ============================================================================
// Example 4: File-based body with imports — serverFn + function-bundler
// ============================================================================

// pricing.server.ts imports `round` from mathUtils.ts; the optional
// @pipesafe/function-bundler package inlines the whole module graph into a
// single self-contained script at pipeline-build time.
const withTax = new Pipeline<Order>().set({
  taxedPrice: {
    $function: {
      body: serverFn(
        applyTax,
        new URL("./server-functions/pricing.server.ts", import.meta.url)
      ),
      args: ["$price"],
      lang: "js",
    },
  },
});

type WithTax = InferOutputType<typeof withTax>;
// WithTax["taxedPrice"] is number — typing flows from applyTax's signature

// ============================================================================
// Inspect the generated stages
// ============================================================================

console.log(JSON.stringify(withTotals.getPipeline(), null, 2));
console.log(JSON.stringify(withGrade.getPipeline(), null, 2));
console.log(JSON.stringify(withDigest.getPipeline(), null, 2));
console.log(JSON.stringify(withTax.getPipeline(), null, 2));

export type { WithTotals, WithGrade, WithTax };
