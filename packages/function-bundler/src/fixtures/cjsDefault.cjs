// A CommonJS module whose default export is `module.exports = fn` — esbuild's
// iife+globalName exposes the function itself as the global, with no "default"
// property. Exercises the CJS default-export fallback in bundleServerFunction.
module.exports = function triple(value) {
  return value * 3;
};
