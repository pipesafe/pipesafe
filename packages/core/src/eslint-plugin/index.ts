import { MONGO_SERVER_GLOBALS } from "../function-helpers/mongoServerGlobals";

/**
 * ESLint plugin for PipeSafe — edit/CI-time enforcement of `$function`
 * body constraints that TypeScript's type system cannot see (function
 * bodies are opaque to types):
 *
 * - `no-impure-function-body`: a `$function` body must be self-contained.
 *   MongoDB executes it in an isolated JS engine, so references to
 *   outer-scope variables (closures, imports) cannot be serialized — the
 *   runtime check would throw when the stage is added; this rule moves
 *   that failure into the editor. It also flags async/generator bodies.
 *   (Param annotations are NOT required: top-level bodies get computed
 *   param types from `args` via FunctionSlots, and nested unannotated
 *   params already fail as TS7006 under noImplicitAny.)
 *
 * Usage (flat config):
 *
 *   import pipesafe from "@pipesafe/core/eslint-plugin";
 *   export default [
 *     { plugins: { pipesafe }, rules: { "pipesafe/no-impure-function-body": "error" } },
 *   ];
 *
 * Implemented with structural types (no dependency on eslint's type
 * packages) so the plugin adds zero runtime dependencies.
 */

// Minimal structural views over ESLint's AST/scope/context — enough for
// this rule without depending on @types/eslint. Frequently accessed slots
// are declared explicitly so dot access works under
// `noPropertyAccessFromIndexSignature`.
interface AstNode {
  type: string;
  parent?: AstNode;
  key?: any;
  value?: any;
  name?: any;
  computed?: any;
  async?: any;
  generator?: any;
  params?: any;
  left?: any;
  [key: string]: any;
}

interface ScopeReference {
  identifier: { name: string; loc: unknown };
  resolved: {
    name: string;
    scope?: { block?: unknown; type?: string };
  } | null;
}

interface EslintVariable {
  name: string;
  defs: { node: AstNode }[];
}

interface EslintScope {
  through: ScopeReference[];
  variables: EslintVariable[];
  upper: EslintScope | null;
}

interface RuleContext {
  sourceCode: {
    scopeManager: {
      acquire(node: AstNode, inner?: boolean): EslintScope | null;
    };
    getScope(node: AstNode): EslintScope;
  };
  report(descriptor: {
    node: unknown;
    messageId: string;
    data?: Record<string, string>;
  }): void;
}

function isFunctionNode(node: AstNode | undefined): node is AstNode {
  return (
    !!node &&
    (node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression")
  );
}

/**
 * If `node` is an identifier bound (once) to a function literal — `const fn =
 * () => ... ` or `function fn() {}` — return that function node so a
 * `body: fn` reference is analyzed like an inline body. Anything ambiguous
 * (reassigned, imported, non-function) returns undefined and is left alone.
 */
function resolveFunctionLiteral(
  idNode: AstNode,
  context: RuleContext
): AstNode | undefined {
  const name = idNode.name as string;
  let scope: EslintScope | null = context.sourceCode.getScope(idNode);
  while (scope) {
    const variable = scope.variables.find((v) => v.name === name);
    if (variable) {
      if (variable.defs.length !== 1) return undefined;
      const defNode = variable.defs[0]?.node;
      if (!defNode) return undefined;
      if (defNode.type === "FunctionDeclaration") return defNode;
      const init = defNode["init"] as AstNode | undefined;
      if (defNode.type === "VariableDeclarator" && isFunctionNode(init))
        return init;
      return undefined;
    }
    scope = scope.upper;
  }
  return undefined;
}

/**
 * Report async/generator functions (at any depth) and dynamic `import()`
 * anywhere inside `fnNode` — none can run in MongoDB's synchronous,
 * module-less server engine. Skips `parent` back-references to avoid cycles.
 */
function reportDisallowedConstructs(
  fnNode: AstNode,
  context: RuleContext
): void {
  const visit = (n: AstNode): void => {
    if (
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression" ||
      n.type === "FunctionDeclaration"
    ) {
      if (n.async === true) context.report({ node: n, messageId: "asyncBody" });
      if (n.generator === true)
        context.report({ node: n, messageId: "generatorBody" });
    }
    if (n.type === "ImportExpression")
      context.report({ node: n, messageId: "dynamicImport" });
    for (const key of Object.keys(n)) {
      if (
        key === "parent" ||
        key === "type" ||
        key === "loc" ||
        key === "range" ||
        key === "start" ||
        key === "end"
      )
        continue;
      const child = n[key] as unknown;
      if (Array.isArray(child)) {
        for (const c of child) {
          if (
            c &&
            typeof c === "object" &&
            typeof (c as AstNode).type === "string"
          )
            visit(c as AstNode);
        }
      } else if (
        child &&
        typeof child === "object" &&
        typeof (child as AstNode).type === "string"
      ) {
        visit(child as AstNode);
      }
    }
  };
  visit(fnNode);
}

/** Is this Property the `body` of an object that is the value of a `$function` property? */
function isFunctionBodyProperty(node: AstNode): boolean {
  if (node.type !== "Property" || node.computed) return false;
  const key = node.key as AstNode;
  const name: unknown = key.type === "Identifier" ? key.name : key.value;
  if (name !== "body") return false;

  const objectExpr = node.parent;
  if (!objectExpr || objectExpr.type !== "ObjectExpression") return false;
  const parentProp = objectExpr.parent;
  if (!parentProp || parentProp.type !== "Property" || parentProp.computed)
    return false;
  const parentKey = parentProp.key as AstNode;
  const parentName: unknown =
    parentKey.type === "Identifier" ? parentKey.name : parentKey.value;
  return parentName === "$function";
}

const noImpureFunctionBody = {
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "$function bodies run inside MongoDB's isolated JS engine and must be self-contained: no outer-scope references, no async/generators, and no dynamic import",
    },
    messages: {
      outerScope:
        "$function body references outer-scope variable '{{name}}'. Server-side functions must be self-contained — move the value inside the function, pass it via 'args', or use serverFn() with @pipesafe/function-bundler.",
      asyncBody:
        "$function body cannot be async — MongoDB server-side JavaScript is synchronous.",
      generatorBody: "$function body cannot be a generator function.",
      dynamicImport:
        "$function body cannot use dynamic import() — MongoDB's server-side JavaScript cannot load modules.",
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      Property(node: AstNode): void {
        if (!isFunctionBodyProperty(node)) return;
        let fn = node.value as AstNode;
        // A body given as a bare identifier (`body: helper`) is resolved to
        // its function-literal definition and analyzed like an inline body,
        // so factoring the body into a `const` doesn't bypass the rule.
        if (fn.type === "Identifier") {
          const resolved = resolveFunctionLiteral(fn, context);
          if (!resolved) return;
          fn = resolved;
        }
        const fnType: unknown = fn.type;
        if (
          fnType !== "FunctionExpression" &&
          fnType !== "ArrowFunctionExpression" &&
          fnType !== "FunctionDeclaration"
        )
          return;

        // async/generator (top-level or nested) and dynamic import().
        reportDisallowedConstructs(fn, context);

        // Free variables: references that pass through the function's scope
        // resolve outside it (or nowhere). `through` includes references
        // escaping from nested scopes too.
        const scope = context.sourceCode.scopeManager.acquire(fn, true);
        if (!scope) return;
        const reported = new Set<string>();
        for (const ref of scope.through) {
          const name = ref.identifier.name;
          if (reported.has(name)) continue;
          const resolved = ref.resolved;
          // A named function expression's self-reference resolves in the
          // wrapper function-expression-name scope, whose block is the
          // function node itself — that binding serializes with the body
          // and is NOT an outer-scope reference (`function fib(n) {
          // return fib(n - 1); }` is self-contained).
          if (resolved?.scope?.block === fn) continue;
          // A reference that resolves to a USER binding in an inner scope is a
          // real closure — flag it even when its name matches a server global
          // (the user shadowed the global). A reference that is unresolved,
          // or resolves to the global scope, is a predefined global: allowed
          // only when it is an actual MongoDB server-side global.
          const isUserBinding =
            resolved !== null && resolved.scope?.type !== "global";
          if (!isUserBinding && MONGO_SERVER_GLOBALS.has(name)) continue;
          reported.add(name);
          context.report({
            node: ref.identifier,
            messageId: "outerScope",
            data: { name },
          });
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "@pipesafe/eslint-plugin",
  },
  rules: {
    "no-impure-function-body": noImpureFunctionBody,
  },
};

export default plugin;
