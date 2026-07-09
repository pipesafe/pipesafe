/**
 * The single free-variable / purity analysis for `$function` bodies, shared
 * by BOTH enforcement layers:
 *
 * - the runtime check (`serializeFunction.ts`) runs it over acorn's parse of
 *   `Function.prototype.toString` and throws on the first violation;
 * - the `no-impure-function-body` ESLint rule (eslint-plugin/index.ts) runs
 *   it directly over the function node ESLint hands the rule (ESLint ASTs
 *   are ESTree-compatible) and turns each violation into a report.
 *
 * One implementation means the editor error and the runtime error cannot
 * drift apart — the divergence class the old twin implementations (acorn
 * walker vs. eslint-scope) needed a conformance corpus to police. The corpus
 * (`purityCorpus.ts`) remains as an integration sanity check.
 *
 * Scoping is STRICT-mode: function declarations in nested blocks are
 * block-scoped (no Annex-B hoisting to function scope). That is the
 * conservative reading — a body rejected here would `ReferenceError` under
 * strict execution, and accepting sloppy-only resolution would let such a
 * body reach the server.
 */

/**
 * Violation reported by the analysis. `freeVariable` carries the referenced
 * name; the caller decides whether it is allowed (e.g. against
 * `MONGO_SERVER_GLOBALS`). `node` is the offending AST node, for ESLint
 * report positioning.
 */
export type FunctionBodyViolation =
  | { kind: "async" | "generator" | "dynamicImport"; node: AnyNode }
  | { kind: "freeVariable"; name: string; node: AnyNode };

// Loose node view over ESTree output (acorn or ESLint) — the walker
// dispatches on `type` and reads child slots dynamically. Frequently
// accessed slots are declared explicitly so dot access works under
// `noPropertyAccessFromIndexSignature`.
export interface AnyNode {
  type: string;
  name?: any;
  value?: any;
  key?: any;
  computed?: any;
  properties?: any;
  elements?: any;
  argument?: any;
  left?: any;
  right?: any;
  id?: any;
  kind?: any;
  declarations?: any;
  init?: any;
  body?: any;
  params?: any;
  async?: any;
  generator?: any;
  superClass?: any;
  param?: any;
  expression?: any;
  object?: any;
  property?: any;
  [key: string]: any;
}

type Report = (violation: FunctionBodyViolation) => void;

/**
 * Visit every child ESTree node of `node` (arrays and single slots),
 * skipping the non-node bookkeeping slots — including `parent`/`range`,
 * which ESLint ASTs carry (skipping `parent` also prevents cycles).
 */
function forEachChildNode(
  node: AnyNode,
  visit: (child: AnyNode) => void
): void {
  for (const key of Object.keys(node)) {
    if (
      key === "type" ||
      key === "start" ||
      key === "end" ||
      key === "loc" ||
      key === "range" ||
      key === "parent"
    )
      continue;
    const child = node[key] as unknown;
    if (Array.isArray(child)) {
      for (const c of child) {
        if (
          c &&
          typeof c === "object" &&
          typeof (c as AnyNode).type === "string"
        )
          visit(c as AnyNode);
      }
    } else if (
      child &&
      typeof child === "object" &&
      typeof (child as AnyNode).type === "string"
    ) {
      visit(child as AnyNode);
    }
  }
}

interface Scope {
  readonly names: Set<string>;
  readonly parent: Scope | null;
}

function declareInScope(scope: Scope, name: string): void {
  scope.names.add(name);
}

function isDeclared(scope: Scope | null, name: string): boolean {
  for (let s = scope; s; s = s.parent) {
    if (s.names.has(name)) return true;
  }
  return false;
}

/** Collect every name bound by a binding pattern (params, declarators, catch). */
function collectPatternNames(
  pattern: AnyNode | null,
  add: (name: string) => void
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      add(pattern.name as string);
      return;
    case "ObjectPattern":
      for (const prop of pattern.properties as AnyNode[]) {
        if (prop.type === "RestElement")
          collectPatternNames(prop.argument as AnyNode, add);
        else collectPatternNames(prop.value as AnyNode, add);
      }
      return;
    case "ArrayPattern":
      for (const el of (pattern.elements as (AnyNode | null)[]) ?? []) {
        collectPatternNames(el, add);
      }
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left as AnyNode, add);
      return;
    case "RestElement":
      collectPatternNames(pattern.argument as AnyNode, add);
      return;
    default:
      return;
  }
}

/**
 * Hoist `var` declarations to the nearest function scope: walks statements
 * recursively but never descends into nested functions. Function
 * declarations are NOT hoisted here — strict mode has no Annex-B function
 * hoisting; block-level declarations come from `hoistLexical` per block.
 * (Over-permissive on TDZ by design — this is a purity check, not a
 * correctness checker; the JS engine reports those.)
 */
function hoistVarScoped(node: AnyNode | null, scope: Scope): void {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "VariableDeclaration":
      if (node.kind === "var") {
        for (const decl of node.declarations as AnyNode[]) {
          collectPatternNames(decl.id as AnyNode, (n) =>
            declareInScope(scope, n)
          );
        }
      }
      return;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return; // separate scopes — handled when visited
    default:
      break;
  }
  forEachChildNode(node, (child) => hoistVarScoped(child, scope));
}

/** Declare block-scoped bindings (`let`/`const`/`class`/`function`) of a statement list. */
function hoistLexical(statements: AnyNode[], scope: Scope): void {
  for (const stmt of statements) {
    switch (stmt.type) {
      case "VariableDeclaration":
        // Everything except `var` is block-scoped: let, const, and the
        // explicit-resource-management kinds ("using", "await using").
        if (stmt.kind !== "var") {
          for (const decl of stmt.declarations as AnyNode[]) {
            collectPatternNames(decl.id as AnyNode, (n) =>
              declareInScope(scope, n)
            );
          }
        }
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (stmt.id) declareInScope(scope, (stmt.id as AnyNode).name as string);
        break;
      default:
        break;
    }
  }
}

/**
 * Walk a binding pattern in declaration position: bound identifiers are
 * declarations (skipped), but computed keys and default values are
 * expressions that may reference outer scope.
 */
function visitPatternExpressions(
  pattern: AnyNode | null,
  scope: Scope,
  report: Report
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      return; // binding, not a reference
    case "ObjectPattern":
      for (const prop of pattern.properties as AnyNode[]) {
        if (prop.type === "RestElement") {
          visitPatternExpressions(prop.argument as AnyNode, scope, report);
        } else {
          if (prop.computed)
            visitExpression(prop.key as AnyNode, scope, report);
          visitPatternExpressions(prop.value as AnyNode, scope, report);
        }
      }
      return;
    case "ArrayPattern":
      for (const el of (pattern.elements as (AnyNode | null)[]) ?? []) {
        visitPatternExpressions(el, scope, report);
      }
      return;
    case "AssignmentPattern":
      visitPatternExpressions(pattern.left as AnyNode, scope, report);
      visitExpression(pattern.right as AnyNode, scope, report);
      return;
    case "RestElement":
      visitPatternExpressions(pattern.argument as AnyNode, scope, report);
      return;
    default:
      visitExpression(pattern, scope, report);
      return;
  }
}

/** Enter a function-like node: bind name + params, hoist body, visit body. */
function visitFunction(node: AnyNode, parent: Scope, report: Report): void {
  // Applies to the root body AND every nested function: MongoDB's
  // server-side engine is synchronous, so an async/generator anywhere in
  // the body cannot run there.
  if (node.async === true) report({ kind: "async", node });
  if (node.generator === true) report({ kind: "generator", node });
  const scope: Scope = { names: new Set(), parent };
  if (node.id) declareInScope(scope, (node.id as AnyNode).name as string);
  // Declare ALL parameter names before visiting any default value: a
  // default may reference a LATER parameter (`(a = b, b) => ...`) — that is
  // a TDZ question for the engine, not an outer-scope reference.
  for (const param of (node.params as AnyNode[]) ?? []) {
    collectPatternNames(param, (n) => declareInScope(scope, n));
  }
  for (const param of (node.params as AnyNode[]) ?? []) {
    visitPatternExpressions(param, scope, report);
  }
  const body = node.body as AnyNode;
  if (body.type === "BlockStatement") {
    hoistVarScoped(body, scope);
    hoistLexical(body.body as AnyNode[], scope);
    for (const stmt of body.body as AnyNode[])
      visitExpression(stmt, scope, report);
  } else {
    visitExpression(body, scope, report); // concise arrow body
  }
}

/** Generic reference-collecting walker. */
function visitExpression(
  node: AnyNode | null,
  scope: Scope,
  report: Report
): void {
  if (!node || typeof node.type !== "string") return;
  // typescript-eslint ASTs interleave TS nodes: expression wrappers
  // (as/satisfies/non-null/instantiation) carry a real `expression` child
  // that must still be analyzed; pure type nodes (annotations, type
  // references) contain type-space identifiers that are NOT runtime
  // references and are skipped entirely. acorn ASTs never produce TS nodes,
  // so the runtime path is unaffected.
  if (node.type.startsWith("TS")) {
    if (node.expression)
      visitExpression(node.expression as AnyNode, scope, report);
    return;
  }
  switch (node.type) {
    case "Identifier":
      if (!isDeclared(scope, node.name as string))
        report({ kind: "freeVariable", name: node.name as string, node });
      return;
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "Literal":
    case "EmptyStatement":
    case "DebuggerStatement":
      return;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      visitFunction(node, scope, report);
      return;
    case "ClassDeclaration":
    case "ClassExpression": {
      const classScope: Scope = { names: new Set(), parent: scope };
      if (node.id)
        declareInScope(classScope, (node.id as AnyNode).name as string);
      if (node.superClass)
        visitExpression(node.superClass as AnyNode, classScope, report);
      for (const member of ((node.body as AnyNode).body as AnyNode[]) ?? []) {
        if (member.type === "StaticBlock") {
          const blockScope: Scope = { names: new Set(), parent: classScope };
          hoistVarScoped(member, blockScope);
          hoistLexical(member.body as AnyNode[], blockScope);
          for (const stmt of member.body as AnyNode[]) {
            visitExpression(stmt, blockScope, report);
          }
          continue;
        }
        if (member.computed)
          visitExpression(member.key as AnyNode, classScope, report);
        if (member.value)
          visitExpression(member.value as AnyNode, classScope, report);
      }
      return;
    }
    case "BlockStatement": {
      const blockScope: Scope = { names: new Set(), parent: scope };
      hoistLexical(node.body as AnyNode[], blockScope);
      for (const stmt of node.body as AnyNode[])
        visitExpression(stmt, blockScope, report);
      return;
    }
    case "VariableDeclaration":
      for (const decl of node.declarations as AnyNode[]) {
        visitPatternExpressions(decl.id as AnyNode, scope, report);
        if (decl.init) visitExpression(decl.init as AnyNode, scope, report);
      }
      return;
    case "MemberExpression":
      visitExpression(node.object as AnyNode, scope, report);
      if (node.computed)
        visitExpression(node.property as AnyNode, scope, report);
      return;
    case "Property":
      if (node.computed) visitExpression(node.key as AnyNode, scope, report);
      visitExpression(node.value as AnyNode, scope, report);
      return;
    case "CatchClause": {
      const catchScope: Scope = { names: new Set(), parent: scope };
      if (node.param) {
        collectPatternNames(node.param as AnyNode, (n) =>
          declareInScope(catchScope, n)
        );
        visitPatternExpressions(node.param as AnyNode, catchScope, report);
      }
      const body = node.body as AnyNode;
      hoistLexical(body.body as AnyNode[], catchScope);
      for (const stmt of body.body as AnyNode[])
        visitExpression(stmt, catchScope, report);
      return;
    }
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement": {
      const loopScope: Scope = { names: new Set(), parent: scope };
      const decls: AnyNode[] = [];
      if (node.init && (node.init as AnyNode).type === "VariableDeclaration") {
        decls.push(node.init as AnyNode);
      }
      if (node.left && (node.left as AnyNode).type === "VariableDeclaration") {
        decls.push(node.left as AnyNode);
      }
      hoistLexical(decls, loopScope);
      for (const key of ["init", "left", "right", "test", "update", "body"]) {
        if (node[key]) visitExpression(node[key] as AnyNode, loopScope, report);
      }
      return;
    }
    case "SwitchStatement": {
      // All cases share ONE lexical scope (per spec) — hoist let/const/
      // class/function declared in any case consequent before visiting.
      visitExpression(node["discriminant"] as AnyNode, scope, report);
      const switchScope: Scope = { names: new Set(), parent: scope };
      const cases = (node["cases"] as AnyNode[] | undefined) ?? [];
      hoistLexical(
        cases.flatMap((c) => (c["consequent"] as AnyNode[] | undefined) ?? []),
        switchScope
      );
      for (const c of cases) {
        if (c["test"])
          visitExpression(c["test"] as AnyNode, switchScope, report);
        for (const stmt of (c["consequent"] as AnyNode[] | undefined) ?? []) {
          visitExpression(stmt, switchScope, report);
        }
      }
      return;
    }
    case "LabeledStatement":
      visitExpression(node.body as AnyNode, scope, report);
      return;
    case "BreakStatement":
    case "ContinueStatement":
      return; // labels are not variable references
    case "ImportExpression":
      // Dynamic `import()` cannot resolve modules inside MongoDB's engine.
      report({ kind: "dynamicImport", node });
      // Still walk the argument — it may reference outer-scope variables.
      forEachChildNode(node, (child) => visitExpression(child, scope, report));
      return;
    default: {
      // Generic fallback: visit every child node/array
      forEachChildNode(node, (child) => visitExpression(child, scope, report));
      return;
    }
  }
}

/**
 * Analyze a function-like ESTree node (`FunctionExpression`,
 * `ArrowFunctionExpression`, or `FunctionDeclaration`) and report every
 * purity violation: async/generator functions (at any depth), dynamic
 * `import()`, and every free-variable reference (the caller filters against
 * its allowlist). Callers choose the failure mode — the runtime check throws
 * on the first violation, the ESLint rule reports them all.
 */
export function analyzeFunctionBody(fnNode: AnyNode, report: Report): void {
  const rootScope: Scope = { names: new Set(), parent: null };
  visitFunction(fnNode, rootScope, report);
}
