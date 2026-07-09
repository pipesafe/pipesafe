import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

/**
 * PipeSafe Function Bundler
 *
 * Bundles a file-based `$function` body — authored in its own module, with
 * imports — into a single self-contained script string that MongoDB's
 * server-side JavaScript engine can execute.
 *
 * This package is an optional peer of `@pipesafe/core`: core lazily loads
 * it at pipeline-build time when a `serverFn()` reference is encountered.
 * Users who only write inline (self-contained) bodies never install it.
 */

export interface ServerFunctionModuleRef {
  /** Absolute file:// URL (or filesystem path) of the module to bundle */
  url: string;
  /** Export holding the function — "default" for default exports */
  exportName: string;
}

export interface BundledServerFunction {
  /** The self-contained `function(){...}` body string sent to MongoDB */
  code: string;
  /**
   * Absolute paths of every file esbuild pulled into the bundle (the entry
   * module and everything it transitively imports). Core content-hashes
   * these to revalidate its bundle cache, so editing any of them in a
   * long-lived process invalidates the cached bundle.
   */
  inputs: string[];
}

/**
 * Bundle the referenced module (esbuild: TS parsed natively, tree-shaken,
 * imports inlined) and wrap it so the named export is invoked with the
 * `$function` args. Unresolvable imports and Node builtins fail loudly as
 * esbuild errors — correct, since they cannot run on the server.
 *
 * Synchronous by design: Pipeline stage chaining is synchronous.
 */
export function bundleServerFunction(
  ref: ServerFunctionModuleRef
): BundledServerFunction {
  const entryPoint =
    ref.url.startsWith("file:") ? fileURLToPath(ref.url) : ref.url;

  const result = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    format: "iife",
    globalName: "__pipesafe_fn",
    platform: "neutral",
    // es2020 matches the MozJS (SpiderMonkey) engine in supported MongoDB
    // server versions
    target: "es2020",
    minify: false,
    logLevel: "silent",
  });

  const output = result.outputFiles[0];
  if (!output) {
    throw new Error(
      `PipeSafe: bundling '${entryPoint}' produced no output — cannot build $function body.`
    );
  }

  // Metafile input keys are paths relative to the working directory.
  const inputs = Object.keys(result.metafile.inputs).map((path) =>
    resolve(path)
  );

  // Forward via `arguments` rather than a rest parameter: esbuild emits a
  // "use strict" directive at the top of the bundle, and directives are
  // illegal in functions with non-simple parameter lists.
  const exportAccess = JSON.stringify(ref.exportName);
  const isDefault = ref.exportName === "default";
  const code = [
    "function() {",
    output.text,
    `  var __pipesafe_export = __pipesafe_fn[${exportAccess}];`,
    // A CommonJS module (`module.exports = fn`) has no "default" property —
    // esbuild's iife globalName holds the function itself. Fall back to the
    // module value when the default export is requested and the namespace is
    // itself callable.
    ...(isDefault ?
      [
        `  if (typeof __pipesafe_export !== "function" && typeof __pipesafe_fn === "function") {`,
        "    __pipesafe_export = __pipesafe_fn;",
        "  }",
      ]
    : []),
    `  if (typeof __pipesafe_export !== "function") {`,
    `    throw new Error("PipeSafe: export " + ${exportAccess} + " of bundled $function module is not a function");`,
    "  }",
    "  return __pipesafe_export.apply(null, arguments);",
    "}",
  ].join("\n");

  return { code, inputs };
}
