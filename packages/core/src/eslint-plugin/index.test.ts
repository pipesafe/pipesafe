import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import plugin from "./index";

const rule = plugin.rules["no-impure-function-body"] as never;

// TS parser so type annotations parse and the unannotated-param check is
// exercised the way consumers will use it.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: "latest" as const,
    sourceType: "module" as const,
  },
});

describe("no-impure-function-body", () => {
  it("enforces self-contained, typed $function bodies", () => {
    ruleTester.run("no-impure-function-body", rule, {
      valid: [
        // Pure body with annotated param
        `p.set({ x: { $function: { body: (a: number) => a * 2, args: ["$age"], lang: "js" } } });`,
        // Unannotated params are fine — the type system supplies them at
        // top level (FunctionSlots) and rejects them as TS7006 when nested
        `p.set({ x: { $function: { body: (a) => a * 2, args: ["$age"], lang: "js" } } });`,
        // Mongo server globals are allowed
        `p.set({ x: { $function: { body: (d: string) => Math.floor(new Date(JSON.parse(d)).getTime()), args: ["$raw"], lang: "js" } } });`,
        // Internal declarations are fine, including hoisting and nested fns
        `p.set({ x: { $function: { body: (xs: number[]) => { const f = 2; return xs.map((v: number) => v * f); }, args: ["$xs"], lang: "js" } } });`,
        // Destructured params don't trip the annotation check (identifier-only)
        `p.set({ x: { $function: { body: ({ a }: { a: number }) => a, args: ["$o"], lang: "js" } } });`,
        // body properties OUTSIDE a $function are not checked
        `register({ body: (a) => a * TAX });`,
        // serverFn refs are not function literals — ignored
        `p.set({ x: { $function: { body: serverFn(applyTax, url), args: ["$p"], lang: "js" } } });`,
        // A named function expression's self-reference is NOT outer scope
        `p.set({ x: { $function: { body: function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }, args: ["$n"], lang: "js" } } });`,
      ],
      invalid: [
        {
          // Closure over an outer variable
          code: `const TAX = 1.2; p.set({ x: { $function: { body: (a: number) => a * TAX, args: ["$age"], lang: "js" } } });`,
          errors: [{ messageId: "outerScope", data: { name: "TAX" } }],
        },
        {
          // Imported symbol
          code: `import { round } from "./util"; p.set({ x: { $function: { body: (a: number) => round(a), args: ["$age"], lang: "js" } } });`,
          errors: [{ messageId: "outerScope", data: { name: "round" } }],
        },
        {
          // console is not a server-side global
          code: `p.set({ x: { $function: { body: (a: number) => { console.log(a); return a; }, args: ["$age"], lang: "js" } } });`,
          errors: [{ messageId: "outerScope", data: { name: "console" } }],
        },
        {
          // Free variable inside a nested function propagates out
          code: `p.set({ x: { $function: { body: (xs: number[]) => xs.map((v: number) => v * factor), args: ["$xs"], lang: "js" } } });`,
          errors: [{ messageId: "outerScope", data: { name: "factor" } }],
        },
        {
          // async bodies cannot run server-side
          code: `p.set({ x: { $function: { body: async (a: number) => a, args: ["$age"], lang: "js" } } });`,
          errors: [{ messageId: "asyncBody" }],
        },
        {
          // generator bodies cannot run server-side
          code: `p.set({ x: { $function: { body: function* (a: number) { yield a; }, args: ["$age"], lang: "js" } } });`,
          errors: [{ messageId: "generatorBody" }],
        },
        {
          // Multiple distinct free variables — each reported once
          code: `p.set({ x: { $function: { body: () => alpha + beta + alpha, args: [], lang: "js" } } });`,
          errors: [
            { messageId: "outerScope", data: { name: "alpha" } },
            { messageId: "outerScope", data: { name: "beta" } },
          ],
        },
      ],
    });
  });
});
