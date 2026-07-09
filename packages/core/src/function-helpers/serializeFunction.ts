import type { parse as AcornParse } from "acorn";
import { Document } from "../utils/objects";
import { MONGO_SERVER_GLOBALS } from "./mongoServerGlobals";
import { analyzeFunctionBody, AnyNode } from "./analyzeFunctionBody";
import { ServerFunctionRef } from "../elements/expressions";

/**
 * Runtime support for the `$function` operator.
 *
 * MongoDB executes `$function` bodies in its own isolated JS engine, so a
 * body must be fully self-contained: closures over outer-scope variables
 * and imported symbols cannot be serialized. `serializeFunctionBody` is the
 * runtime backstop that enforces this: it parses the function's source with
 * acorn and runs the SHARED purity analysis (`analyzeFunctionBody.ts` — the
 * same walker the `no-impure-function-body` ESLint rule executes at
 * edit/CI time), throwing — naming the offending identifiers — before the
 * pipeline ever reaches the server.
 *
 * No transpilation is needed: by the time this code runs, the function
 * source returned by `Function.prototype.toString` is already plain
 * JavaScript in every TypeScript execution environment (bun/tsx transpile
 * on load, tsc compiles ahead of time, Node's type-stripping blanks
 * annotations).
 */

// ---------------------------------------------------------------------------
// Lazy Node/acorn loading
// ---------------------------------------------------------------------------
//
// `acorn` and Node's `module` builtin are needed ONLY when a $function body
// is actually serialized. Importing them statically would drag `node:module`
// (and acorn) into the module graph of `@pipesafe/core`, breaking
// browser/edge bundling even for consumers that never use $function. Both are
// therefore obtained lazily, synchronously, through a `require` acquired
// without any static `node:module` import.

type NodeRequire = (id: string) => unknown;

let cachedRequire: NodeRequire | undefined;
let cachedParse: typeof AcornParse | undefined;

function nodeRequire(): NodeRequire {
  if (cachedRequire) return cachedRequire;
  // `process.getBuiltinModule` (Node >= 20.16 / 22.3) returns the `module`
  // builtin synchronously and — unlike a static `import "node:module"` — is
  // invisible to bundlers, so it never forces Node builtins into a browser
  // build. Referenced through `globalThis` so this file has no compile-time
  // dependency on Node globals.
  const proc = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const mod = proc?.getBuiltinModule?.("module") as
    | { createRequire?: (url: string | URL) => NodeRequire }
    | undefined;
  if (!mod?.createRequire) {
    throw new Error(
      "PipeSafe: serializing a $function body requires a Node.js runtime " +
        "(>= 20.16). Server-side function bodies are a Node-only feature."
    );
  }
  cachedRequire = mod.createRequire(import.meta.url);
  return cachedRequire;
}

function acornParse(code: string): unknown {
  if (!cachedParse) {
    cachedParse = (nodeRequire()("acorn") as { parse: typeof AcornParse })
      .parse;
  }
  return cachedParse(code, { ecmaVersion: "latest" });
}

function parseFunctionExpression(src: string): { node: AnyNode; emit: string } {
  const tryParse = (code: string): AnyNode | undefined => {
    try {
      const program = acornParse(code) as AnyNode;
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
  // Native/bound functions stringify as `function name() { [native code] }`
  // and NOTHING else — anchor the match to that whole shape so a legitimate
  // body that merely CONTAINS the text `{ [native code] }` (in a string or
  // regex literal, alongside its real code) is not misclassified.
  if (/^function[^(]*\(\)\s*\{\s*\[native code\]\s*\}$/.test(src.trim())) {
    throw new Error(
      "PipeSafe: $function body is a native or bound function and cannot be serialized — " +
        "pass a plain arrow function or function expression."
    );
  }

  const { node: fnNode, emit } = parseFunctionExpression(src);

  // The shared walk reports async/generator (at any depth), dynamic
  // import(), and free variables; the runtime failure mode is to throw on
  // the first structural violation and aggregate free-variable names.
  const freeVariables = new Set<string>();
  analyzeFunctionBody(fnNode, (violation) => {
    switch (violation.kind) {
      case "async":
        throw new Error(
          "PipeSafe: $function body cannot be async — MongoDB server-side JavaScript is synchronous."
        );
      case "generator":
        throw new Error(
          "PipeSafe: $function body cannot be a generator function."
        );
      case "dynamicImport":
        throw new Error(
          "PipeSafe: $function body cannot use dynamic import() — server-side JavaScript cannot load modules."
        );
      case "freeVariable":
        if (!MONGO_SERVER_GLOBALS.has(violation.name))
          freeVariables.add(violation.name);
        return;
    }
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
  bundleServerFunction(ref: { url: string; exportName: string }): {
    code: string;
    inputs: string[];
  };
}

let cachedBundler: FunctionBundler | undefined;

function loadBundler(): FunctionBundler {
  if (!cachedBundler) {
    try {
      cachedBundler = nodeRequire()(
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

// A given inline body / bundled module is invariant while its source is, so
// serialization is memoized: pipelines are frequently rebuilt (e.g. per
// request), and re-parsing or re-bundling the same body on every build is
// wasted work. Inline bodies key on the function reference; serverFn
// bundles key on url + export name and are revalidated against a content
// hash of every file esbuild pulled into the bundle, so editing a server
// module (or anything it imports) in a long-lived process is picked up on
// the next build instead of serving a stale bundle.
const inlineBodyCache = new WeakMap<object, string>();

interface CachedBundle {
  code: string;
  /** absolute path -> sha-256 of the file content at bundle time */
  fileHashes: Map<string, string>;
}

const serverFnBundleCache = new Map<string, CachedBundle>();

interface NodeFs {
  readFileSync(path: string): Uint8Array;
}
interface NodeCrypto {
  createHash(algorithm: string): {
    update(data: Uint8Array): { digest(encoding: "hex"): string };
  };
}

function hashFile(path: string): string {
  const req = nodeRequire();
  const fs = req("node:fs") as NodeFs;
  const crypto = req("node:crypto") as NodeCrypto;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path))
    .digest("hex");
}

function bundleInputsUnchanged(fileHashes: Map<string, string>): boolean {
  for (const [path, hash] of fileHashes) {
    try {
      if (hashFile(path) !== hash) return false;
    } catch {
      return false; // deleted/unreadable — rebundle and let esbuild report it
    }
  }
  return true;
}

function resolveBody(body: unknown): unknown {
  if (typeof body === "function") {
    const cached = inlineBodyCache.get(body);
    if (cached !== undefined) return cached;
    const source = serializeFunctionBody(body as (...args: never[]) => unknown);
    inlineBodyCache.set(body, source);
    return source;
  }
  if (isServerFunctionRef(body)) {
    const key = `${body.url}\0${body.exportName}`;
    const cached = serverFnBundleCache.get(key);
    if (cached && bundleInputsUnchanged(cached.fileHashes)) return cached.code;
    const { code, inputs } = loadBundler().bundleServerFunction({
      url: body.url,
      exportName: body.exportName,
    });
    const fileHashes = new Map(inputs.map((path) => [path, hashFile(path)]));
    serverFnBundleCache.set(key, { code, fileHashes });
    return code;
  }
  return body;
}

/**
 * Cheap allocation-free probe: does this stage contain a `$function` key at
 * any depth? The serialization walk below rebuilds every container it
 * visits, and `$function`-free stages — the overwhelmingly common case —
 * should not pay that on every stage add.
 */
function containsFunctionKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    for (const el of value) {
      if (containsFunctionKey(el)) return true;
    }
    return false;
  }
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (key === "$function") return true;
    if (containsFunctionKey(value[key])) return true;
  }
  return false;
}

/**
 * Recursively replace `$function` bodies with their serialized source.
 * Returns the SAME reference when nothing in the subtree changed, so
 * sibling subtrees without a `$function` keep structural sharing.
 *
 * Non-plain objects — Date, RegExp, and BSON wrapper types (ObjectId,
 * Decimal128, ...) — pass through untouched: recursing into them would
 * rebuild them as plain objects and corrupt the value. A `$function` spec is
 * always a plain object literal (the type system enforces this), so bodies
 * are never hidden inside such values in practice.
 */
function walkValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((el) => {
      const next = walkValue(el);
      if (next !== el) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (!isPlainObject(value)) return value;
  let changed = false;
  const out: Document = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$function" && isPlainObject(child)) {
      // Walk the $function operand: `body` is serialized; other keys (`args`,
      // which may nest further $functions, and `lang`) are walked normally.
      // A $function object with no `body` key is left without one — never
      // given a phantom `body: undefined`.
      let specChanged = false;
      const spec: Document = {};
      for (const [k, v] of Object.entries(child)) {
        const next = k === "body" ? resolveBody(v) : walkValue(v);
        spec[k] = next;
        if (next !== v) specChanged = true;
      }
      const nextChild = specChanged ? spec : child;
      out[key] = nextChild;
      if (nextChild !== child) changed = true;
    } else {
      const next = walkValue(child);
      out[key] = next;
      if (next !== child) changed = true;
    }
  }
  return changed ? out : value;
}

/**
 * Replace every `$function` body (at any depth, including inside `custom()`
 * stages and sub-pipelines) with its serialized source string. Stages with
 * no `$function` are returned by reference, unmodified — the boolean
 * pre-scan means the common case never allocates.
 */
export function serializeFunctionBodies(stages: Document[]): Document[] {
  return stages.map((stage) =>
    containsFunctionKey(stage) ? (walkValue(stage) as Document) : stage
  );
}
