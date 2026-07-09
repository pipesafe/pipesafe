import { MONGO_SERVER_GLOBALS } from "../function-helpers/mongoServerGlobals";
import {
  analyzeFunctionBody,
  AnyNode,
} from "../function-helpers/analyzeFunctionBody";

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
 * The rule executes the SAME analysis as the runtime check — the shared
 * walker in `function-helpers/analyzeFunctionBody.ts` (ESLint ASTs are
 * ESTree-compatible) — so the editor error and the runtime error cannot
 * drift apart. On top of that shared analysis the rule adds ONE check the
 * runtime is structurally blind to: a closure over a user binding whose
 * name shadows a server global (`const Date = myDate` outside the body).
 * `Function.prototype.toString` carries no lexical context, so only the
 * scope-aware lint layer can catch it.
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

// Minimal structural views over ESLint's scope/context — enough for this
// rule without depending on @types/eslint. AST nodes reuse the shared
// walker's `AnyNode` view (ESLint nodes additionally carry `parent`
// back-references, which the walker skips).

interface ScopeReference {
  identifier: { name: string; loc: unknown };
  resolved: {
    name: string;
    scope?: { block?: unknown; type?: string };
  } | null;
}

interface EslintVariable {
  name: string;
  defs: { node: AnyNode }[];
}

interface EslintScope {
  through: ScopeReference[];
  variables: EslintVariable[];
  upper: EslintScope | null;
}

interface RuleContext {
  sourceCode: {
    scopeManager: {
      acquire(node: AnyNode, inner?: boolean): EslintScope | null;
    };
    getScope(node: AnyNode): EslintScope;
  };
  report(descriptor: {
    node: unknown;
    messageId: string;
    data?: Record<string, string>;
  }): void;
}

function isFunctionNode(node: AnyNode | undefined): node is AnyNode {
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
  idNode: AnyNode,
  context: RuleContext
): AnyNode | undefined {
  const name = idNode.name as string;
  let scope: EslintScope | null = context.sourceCode.getScope(idNode);
  while (scope) {
    const variable = scope.variables.find((v) => v.name === name);
    if (variable) {
      if (variable.defs.length !== 1) return undefined;
      const defNode = variable.defs[0]?.node;
      if (!defNode) return undefined;
      if (defNode.type === "FunctionDeclaration") return defNode;
      const init = defNode["init"] as AnyNode | undefined;
      if (defNode.type === "VariableDeclarator" && isFunctionNode(init))
        return init;
      return undefined;
    }
    scope = scope.upper;
  }
  return undefined;
}

/** Is this Property the `body` of an object that is the value of a `$function` property? */
function isFunctionBodyProperty(node: AnyNode): boolean {
  if (node.type !== "Property" || node.computed) return false;
  const key = node.key as AnyNode;
  const name: unknown = key.type === "Identifier" ? key.name : key.value;
  if (name !== "body") return false;

  const objectExpr = node["parent"] as AnyNode | undefined;
  if (!objectExpr || objectExpr.type !== "ObjectExpression") return false;
  const parentProp = objectExpr["parent"] as AnyNode | undefined;
  if (!parentProp || parentProp.type !== "Property" || parentProp.computed)
    return false;
  const parentKey = parentProp.key as AnyNode;
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
      Property(node: AnyNode): void {
        if (!isFunctionBodyProperty(node)) return;
        let fn = node.value as AnyNode;
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

        // The shared analysis — identical semantics to the runtime check.
        const reported = new Set<string>();
        analyzeFunctionBody(fn, (violation) => {
          switch (violation.kind) {
            case "async":
              context.report({ node: violation.node, messageId: "asyncBody" });
              return;
            case "generator":
              context.report({
                node: violation.node,
                messageId: "generatorBody",
              });
              return;
            case "dynamicImport":
              context.report({
                node: violation.node,
                messageId: "dynamicImport",
              });
              return;
            case "freeVariable":
              if (MONGO_SERVER_GLOBALS.has(violation.name)) return;
              if (reported.has(violation.name)) return;
              reported.add(violation.name);
              context.report({
                node: violation.node,
                messageId: "outerScope",
                data: { name: violation.name },
              });
              return;
          }
        });

        // ADDITIVE, lint-only check: a free reference whose name matches a
        // server global passes the shared analysis (the runtime allowlists
        // it — a toString source carries no lexical context), but if the
        // reference actually resolves to a USER binding outside the body
        // (the user shadowed the global), it is a real closure: the server
        // would run the built-in, not the user's value. Only eslint-scope
        // can see this.
        const scope = context.sourceCode.scopeManager.acquire(fn, true);
        if (!scope) return;
        for (const ref of scope.through) {
          const name = ref.identifier.name;
          if (!MONGO_SERVER_GLOBALS.has(name)) continue; // shared walk handled it
          if (reported.has(name)) continue;
          const resolved = ref.resolved;
          // A named function expression's self-reference resolves in the
          // wrapper function-expression-name scope, whose block is the
          // function node itself — that binding serializes with the body
          // and is NOT an outer-scope reference.
          if (resolved?.scope?.block === fn) continue;
          const isUserBinding =
            resolved !== null && resolved.scope?.type !== "global";
          if (!isUserBinding) continue;
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
