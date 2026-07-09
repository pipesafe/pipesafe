/**
 * Shared conformance corpus for `$function` body purity.
 *
 * The SAME invariant — a body must be self-contained, synchronous, and
 * module-free — is enforced at runtime by `serializeFunctionBody`
 * (function-helpers/serializeFunction.ts) and at edit/CI time by the
 * `no-impure-function-body` ESLint rule (eslint-plugin/index.ts). Both run
 * the SAME analysis (function-helpers/analyzeFunctionBody.ts), so agreement
 * holds by construction; this corpus is the integration sanity check that
 * the two HOSTS wire the shared walker up equivalently (parse/AST source,
 * allowlist filtering, error surfacing).
 *
 * `purityCorpus.test.ts` runs every case below through BOTH checkers and
 * asserts they agree. Each `code` is a function-expression source that both
 * a runtime `new Function` and the ESLint `$function` template can host, so
 * impurity is expressed through references to UNDECLARED identifiers (both
 * checkers treat those as outer-scope) rather than real closures (which the
 * Function constructor cannot reconstruct).
 *
 * Intentionally NOT covered here: native/bound-function detection (runtime-
 * only — the ESLint rule cannot know `Math.floor` is native; lives in
 * serializeFunction.test.ts) and shadowed-server-global closures (lint-only
 * — a toString source carries no lexical context; lives in
 * eslint-plugin/index.test.ts).
 */
export interface PurityCase {
  readonly name: string;
  /** A function-expression source (arrow or `function`). */
  readonly code: string;
  /** Whether both checkers must ACCEPT (true) or REJECT (false) it. */
  readonly valid: boolean;
}

export const PURITY_CORPUS: readonly PurityCase[] = [
  // --- Self-contained: accepted ---------------------------------------------
  { name: "pure arithmetic", code: "(a) => a * 2", valid: true },
  {
    name: "local binding",
    code: "(x) => { const y = 2; return x + y; }",
    valid: true,
  },
  {
    name: "member chain leading object only",
    code: "(o) => o.a.b",
    valid: true,
  },
  {
    name: "pure nested arrow",
    code: "(xs) => xs.map((v) => v * 2)",
    valid: true,
  },
  {
    name: "named function self-reference",
    code: "function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }",
    valid: true,
  },
  {
    // A default value referencing a LATER parameter is a parameter-scope
    // (TDZ) question for the engine, not an outer-scope reference.
    name: "default parameter referencing a later parameter",
    code: "(a = b, b) => a + b",
    valid: true,
  },
  // Server-side globals (including ones added to the allowlist).
  { name: "Math global", code: "(a) => Math.floor(a)", valid: true },
  { name: "JSON global", code: "(d) => JSON.parse(d)", valid: true },
  { name: "BigInt global", code: "(a) => BigInt(a)", valid: true },
  {
    name: "encodeURIComponent global",
    code: "(s) => encodeURIComponent(s)",
    valid: true,
  },

  // --- Impure / non-serializable: rejected ----------------------------------
  { name: "outer-scope closure", code: "(a) => a * TAX", valid: false },
  { name: "two free variables", code: "() => beta + alpha", valid: false },
  {
    name: "console (not a server global)",
    code: "(a) => { console.log(a); return a; }",
    valid: false,
  },
  {
    name: "Promise (not a server global — engine is synchronous)",
    code: "(a) => Promise.resolve(a)",
    valid: false,
  },
  {
    name: "free variable in nested arrow",
    code: "(xs) => xs.map((v) => v * factor)",
    valid: false,
  },
  { name: "async body", code: "async (a) => a", valid: false },
  { name: "generator body", code: "function* (a) { yield a; }", valid: false },
  {
    name: "nested async function",
    code: "(a) => { async function h() { return a; } return h; }",
    valid: false,
  },
  {
    name: "nested generator function",
    code: "(a) => { function* g() { yield a; } return g; }",
    valid: false,
  },
  { name: "dynamic import", code: "(x) => import('mod') || x", valid: false },
  {
    // Strict-mode scoping: a function declaration inside a nested block is
    // block-scoped (no Annex-B hoisting), so referencing it outside the
    // block is a free variable.
    name: "block-scoped function declaration escaping its block",
    code: "(a) => { { function g() { return a; } } return g(); }",
    valid: false,
  },
];
