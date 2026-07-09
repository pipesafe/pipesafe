/**
 * Identifiers available to server-side JavaScript executed by MongoDB's
 * `$function` operator. A `$function` body may reference these freely —
 * anything else outside the function's own scope cannot be serialized and
 * is rejected by the purity check (function-helpers/serializeFunction.ts) and the
 * `no-impure-function-body` ESLint rule.
 *
 * Intentionally excludes `console`, `print`, timers, `Promise`, and other
 * host APIs that are not available (or not synchronous) inside the server's
 * JS engine.
 */
export const MONGO_SERVER_GLOBALS: ReadonlySet<string> = new Set([
  // ECMAScript value/collection builtins
  "Array",
  "ArrayBuffer",
  "BigInt",
  "Boolean",
  "DataView",
  "Date",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  // NO `Promise`: the server engine is synchronous (no event loop /
  // microtask draining), so a returned Promise is never resolved — the
  // same constraint that rejects async/generator bodies outright.
  "Proxy",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "WeakMap",
  "WeakSet",
  // Typed arrays
  "BigInt64Array",
  "BigUint64Array",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  // ECMAScript error types
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  // ECMAScript global values and functions
  "Infinity",
  "NaN",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
  // Function-internal bindings
  "arguments",
  // MongoDB server-side / BSON helpers
  "BinData",
  "DBRef",
  "HexData",
  "ISODate",
  "MaxKey",
  "MD5",
  "MinKey",
  "NumberDecimal",
  "NumberInt",
  "NumberLong",
  "ObjectId",
  "Timestamp",
  "UUID",
]);
