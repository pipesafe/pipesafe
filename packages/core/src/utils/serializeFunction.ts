import { createRequire } from "node:module";
import { parse } from "acorn";
import { Document } from "./objects";
import { MONGO_SERVER_GLOBALS } from "./mongoServerGlobals";
import { ServerFunctionRef } from "../elements/expressions";

/**
 * Runtime support for the `$function` operator.
 *
 * MongoDB executes `$function` bodies in its own isolated JS engine, so a
 * body must be fully self-contained: closures over outer-scope variables
 * and imported symbols cannot be serialized. `serializeFunctionBody` is the
 * runtime backstop that enforces this (the `no-impure-function-body` ESLint
 * rule catches the same mistakes at edit/CI time): it parses the function's
 * source with acorn, performs a free-variable analysis, and throws — naming
 * the offending identifiers — before the pipeline ever reaches the server.
 *
 * No transpilation is needed: by the time this code runs, the function
 * source returned by `Function.prototype.toString` is already plain
 * JavaScript in every TypeScript execution environment (bun/tsx transpile
 * on load, tsc compiles ahead of time, Node's type-stripping blanks
 * annotations).
 */

// Loose node view over acorn's ESTree output — the walker dispatches on
// `type` and reads child slots dynamically. Frequently accessed slots are
// declared explicitly so dot access works under
// `noPropertyAccessFromIndexSignature`.
interface AnyNode {
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
 * Hoist `var` declarations and function declarations to the nearest
 * function scope: walks statements recursively but never descends into
 * nested functions. (Over-permissive on TDZ by design — this is a purity
 * check, not a correctness checker; the JS engine reports those.)
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
      if (node.id) declareInScope(scope, (node.id as AnyNode).name as string);
      return; // do not descend into the nested function
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return; // separate scopes — handled when visited
    default:
      break;
  }
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc")
      continue;
    const child = node[key] as unknown;
    if (Array.isArray(child)) {
      for (const c of child) hoistVarScoped(c as AnyNode, scope);
    } else if (child && typeof child === "object") {
      hoistVarScoped(child as AnyNode, scope);
    }
  }
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
  report: (name: string) => void
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
function visitFunction(
  node: AnyNode,
  parent: Scope,
  report: (name: string) => void
): void {
  const scope: Scope = { names: new Set(), parent };
  if (node.id) declareInScope(scope, (node.id as AnyNode).name as string);
  for (const param of (node.params as AnyNode[]) ?? []) {
    collectPatternNames(param, (n) => declareInScope(scope, n));
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
  report: (name: string) => void
): void {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "Identifier":
      if (!isDeclared(scope, node.name as string)) report(node.name as string);
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
    default: {
      // Generic fallback: visit every child node/array
      for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end" || key === "loc")
          continue;
        const child = node[key] as unknown;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c === "object" && "type" in (c as object)) {
              visitExpression(c as AnyNode, scope, report);
            }
          }
        } else if (
          child &&
          typeof child === "object" &&
          "type" in (child as object)
        ) {
          visitExpression(child as AnyNode, scope, report);
        }
      }
      return;
    }
  }
}

function parseFunctionExpression(src: string): { node: AnyNode; emit: string } {
  const tryParse = (code: string): AnyNode | undefined => {
    try {
      const program = parse(code, {
        ecmaVersion: "latest",
      }) as unknown as AnyNode;
      const stmt = (program.body as AnyNode[])[0];
      if (stmt && stmt.type === "ExpressionStatement")
        return stmt.expression as AnyNode;
      return undefined;
    } catch {
      return undefined;
    }
  };

  // Wrapping in parens makes `function ... {}` parse as an expression
  const direct = tryParse(`(${src})`);
  if (direct && direct.type === "FunctionExpression") {
    return { node: direct, emit: src };
  }
  if (direct && direct.type === "ArrowFunctionExpression") {
    // MongoDB's $function only executes `function` syntax — an arrow-source
    // string is treated as a Code VALUE rather than being invoked. Wrap it.
    return {
      node: direct,
      emit: `function() { return (${src}).apply(null, arguments); }`,
    };
  }

  // Shorthand-method source (`foo() {...}` from `{ foo() {} }.foo`)
  const recovered = tryParse(`(function ${src})`);
  if (recovered && recovered.type === "FunctionExpression") {
    return { node: recovered, emit: `function ${src}` };
  }

  throw new Error(
    "PipeSafe: $function body must be an arrow function or function expression — " +
      "its source could not be parsed for serialization."
  );
}

/**
 * Serialize a `$function` body to the source string sent to MongoDB,
 * enforcing that it is self-contained. Throws when the body is native or
 * bound, async or a generator, or references identifiers from outer scope
 * that are not MongoDB server-side globals.
 */
export function serializeFunctionBody(
  fn: (...args: never[]) => unknown
): string {
  const src = Function.prototype.toString.call(fn);
  if (src.includes("[native code]")) {
    throw new Error(
      "PipeSafe: $function body is a native or bound function and cannot be serialized — " +
        "pass a plain arrow function or function expression."
    );
  }

  const { node: fnNode, emit } = parseFunctionExpression(src);
  if (fnNode.async === true) {
    throw new Error(
      "PipeSafe: $function body cannot be async — MongoDB server-side JavaScript is synchronous."
    );
  }
  if (fnNode.generator === true) {
    throw new Error("PipeSafe: $function body cannot be a generator function.");
  }

  const freeVariables = new Set<string>();
  const rootScope: Scope = { names: new Set(), parent: null };
  visitFunction(fnNode, rootScope, (name) => {
    if (!MONGO_SERVER_GLOBALS.has(name)) freeVariables.add(name);
  });

  if (freeVariables.size > 0) {
    const names = [...freeVariables]
      .sort()
      .map((n) => `'${n}'`)
      .join(", ");
    throw new Error(
      `PipeSafe: $function body references variables not defined inside the function: ${names}. ` +
        "Server-side functions must be self-contained — closures and imports cannot be " +
        "serialized. Move the value inside the function, pass it via 'args', or author the " +
        "body in its own module with serverFn() and @pipesafe/function-bundler."
    );
  }

  return emit;
}

// ============================================================================
// serverFn — file-based bodies (bundled via @pipesafe/function-bundler)
// ============================================================================

/**
 * Reference a `$function` body authored in its own module. Unlike inline
 * bodies (which must be self-contained), a file-based body may import
 * helpers: at pipeline-build time the optional `@pipesafe/function-bundler`
 * package bundles the module — dependencies included — into a single
 * self-contained body string.
 *
 * @example
 * // pricing.server.ts:  export default (price: number) => round(price * 1.2)
 * import applyTax from "./pricing.server";
 *
 * pipeline.set({
 *   taxed: {
 *     $function: {
 *       body: serverFn(applyTax, import.meta.resolve("./pricing.server.ts")),
 *       args: ["$price"],
 *       lang: "js",
 *     },
 *   },
 * });
 */
export function serverFn<F extends (...args: any[]) => unknown>(
  fn: F,
  url: string | URL,
  exportName = "default"
): ServerFunctionRef<F> {
  return { "~pipesafe.serverFn": true, fn, url: String(url), exportName };
}

export function isServerFunctionRef(
  value: unknown
): value is ServerFunctionRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["~pipesafe.serverFn"] === true
  );
}

interface FunctionBundler {
  bundleServerFunction(ref: { url: string; exportName: string }): string;
}

let cachedBundler: FunctionBundler | undefined;

function loadBundler(): FunctionBundler {
  if (!cachedBundler) {
    const requireFn = createRequire(import.meta.url);
    try {
      cachedBundler = requireFn(
        "@pipesafe/function-bundler"
      ) as FunctionBundler;
    } catch {
      throw new Error(
        "PipeSafe: file-based $function bodies require the optional " +
          "'@pipesafe/function-bundler' package. Install it with " +
          "'bun add @pipesafe/function-bundler' (or npm/pnpm/yarn equivalent)."
      );
    }
  }
  return cachedBundler;
}

// ============================================================================
// Stage walking — serialize every $function body in a stage list
// ============================================================================

function isPlainObject(value: unknown): value is Document {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function resolveBody(body: unknown): unknown {
  if (typeof body === "function") {
    return serializeFunctionBody(body as (...args: never[]) => unknown);
  }
  if (isServerFunctionRef(body)) {
    return loadBundler().bundleServerFunction({
      url: body.url,
      exportName: body.exportName,
    });
  }
  return body;
}

function walkValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walkValue);
  if (!isPlainObject(value)) return value; // Date, RegExp, BSON types, functions, primitives
  const out: Document = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$function" && isPlainObject(child)) {
      const spec = walkValue(child) as Document; // args may nest $function
      spec["body"] = resolveBody(child["body"]);
      out[key] = spec;
    } else {
      out[key] = walkValue(child);
    }
  }
  return out;
}

/**
 * Replace every `$function` body (at any depth, including inside `custom()`
 * stages and sub-pipelines) with its serialized source string. Values that
 * are not plain objects/arrays — Date, RegExp, BSON types — pass through
 * untouched.
 */
export function serializeFunctionBodies(stages: Document[]): Document[] {
  return stages.map((stage) => walkValue(stage) as Document);
}
