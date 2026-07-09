import { describe, expect, it } from "vitest";
import { Linter, type ESLint } from "eslint";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import plugin from "../eslint-plugin/index";
import { serializeFunctionBody } from "./serializeFunction";
import { PURITY_CORPUS } from "./purityCorpus";

// ============================================================================
// Purity conformance — the runtime check and the ESLint rule must agree
// ============================================================================
//
// Guards against drift between the two independent purity analyses (see
// purityCorpus.ts). Runs every corpus case through both and asserts each
// either accepts it or rejects it — never one but not the other.

const RULE_ID = "pipesafe/no-impure-function-body";
const linter = new Linter();

/** Materialize the source and ask the runtime check: is it rejected? */
function runtimeRejects(code: string): boolean {
  // The body is never invoked, so undeclared free identifiers are fine at
  // construction — the purity check reads the source, it does not run it.
  const fn = new Function(`return (${code})`)() as (
    ...args: never[]
  ) => unknown;
  try {
    serializeFunctionBody(fn);
    return false;
  } catch {
    return true;
  }
}

/** Lint the source inside a $function template: how many rule errors? */
function lintErrorCount(code: string): number {
  const source = `declare const p: any; p.set({ x: { $function: { body: ${code}, args: [], lang: "js" } } });`;
  const messages = linter.verify(source, {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      // Mirror the repo's real config, where server globals that are ALSO
      // browser globals (Math, JSON, console, ...) resolve to the global
      // scope — the case that exercises the shadowing logic.
      globals: globals.browser,
    },
    plugins: { pipesafe: plugin as unknown as ESLint.Plugin },
    rules: { [RULE_ID]: "error" },
  });
  return messages.filter((m) => m.ruleId === RULE_ID).length;
}

describe("purity conformance corpus", () => {
  it.each(PURITY_CORPUS)(
    "runtime and lint agree on $name (valid=$valid)",
    ({ code, valid }) => {
      expect(runtimeRejects(code)).toBe(!valid);
      const lintCount = lintErrorCount(code);
      if (valid) {
        expect(lintCount).toBe(0);
      } else {
        expect(lintCount).toBeGreaterThan(0);
      }
    }
  );
});
