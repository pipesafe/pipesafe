/**
 * Identifiers available to server-side JavaScript executed by MongoDB's
 * `$function` operator. A `$function` body may reference these freely —
 * anything else outside the function's own scope cannot be serialized and
 * is rejected by the purity check (utils/serializeFunction.ts) and the
 * `no-impure-function-body` ESLint rule.
 *
 * Intentionally excludes `console`, `print`, timers, `Promise`, and other
 * host APIs that are not available (or not synchronous) inside the server's
 * JS engine.
 */
export const MONGO_SERVER_GLOBALS: ReadonlySet<string> = new Set([
  // ECMAScript builtins
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Infinity",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "RangeError",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "TypeError",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
  // Function-internal bindings
  "arguments",
  // MongoDB server-side helpers
  "BinData",
  "ISODate",
  "NumberDecimal",
  "NumberInt",
  "NumberLong",
  "ObjectId",
]);
