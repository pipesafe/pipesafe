import { MONGO_SERVER_GLOBALS } from "../utils/mongoServerGlobals";

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
  resolved: { name: string; scope?: { block?: unknown } } | null;
}

interface EslintScope {
  through: ScopeReference[];
}

interface RuleContext {
  sourceCode: {
    scopeManager: {
      acquire(node: AstNode, inner?: boolean): EslintScope | null;
    };
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
        "$function bodies run inside MongoDB's isolated JS engine and must be self-contained: no outer-scope references and no async/generators",
    },
    messages: {
      outerScope:
        "$function body references outer-scope variable '{{name}}'. Server-side functions must be self-contained — move the value inside the function, pass it via 'args', or use serverFn() with @pipesafe/function-bundler.",
      asyncBody:
        "$function body cannot be async — MongoDB server-side JavaScript is synchronous.",
      generatorBody: "$function body cannot be a generator function.",
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      Property(node: AstNode): void {
        if (!isFunctionBodyProperty(node)) return;
        const fn = node.value as AstNode;
        if (!isFunctionNode(fn)) return;

        if (fn.async === true) {
          context.report({ node: fn, messageId: "asyncBody" });
        }
        if (fn.generator === true) {
          context.report({ node: fn, messageId: "generatorBody" });
        }

        // Free variables: references that pass through the function's scope
        // resolve outside it (or nowhere). `through` includes references
        // escaping from nested scopes too.
        const scope = context.sourceCode.scopeManager.acquire(fn, true);
        if (!scope) return;
        const reported = new Set<string>();
        for (const ref of scope.through) {
          const name = ref.identifier.name;
          if (MONGO_SERVER_GLOBALS.has(name) || reported.has(name)) continue;
          // A named function expression's self-reference resolves in the
          // wrapper function-expression-name scope, whose block is the
          // function node itself — that binding serializes with the body
          // and is NOT an outer-scope reference (`function fib(n) {
          // return fib(n - 1); }` is self-contained).
          if (ref.resolved?.scope?.block === fn) continue;
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
