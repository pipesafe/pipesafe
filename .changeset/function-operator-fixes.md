---
"@pipesafe/core": patch
"@pipesafe/function-bundler": patch
---

Fix and harden the `$function` operator following review:

- `@pipesafe/core` no longer statically imports `acorn` or `node:module`, so browser/edge bundles that never use `$function` build cleanly; both are lazily required only when a body is serialized
- Purity check: nested `async`/generator functions and dynamic `import()` are now rejected (previously only the top-level function was checked); a body that merely contains the text `[native code]` is no longer misclassified as a native function
- `MONGO_SERVER_GLOBALS` gained the missing engine globals (`BigInt`, the `encode/decodeURI*` functions, typed arrays, `WeakMap`/`WeakSet`, more error types and BSON helpers), so valid bodies using them are no longer rejected
- Body argument typing: object-literal args now resolve nested `$field` references (`{ n: "$name" }` → `{ n: string }`), and a nullable field (`number | null`) keeps its `null` in the body parameter type instead of being silently stripped
- `serializeFunctionBodies` returns `$function`-free stages by reference (no deep clone), never injects a phantom `body: undefined`, and caches inline-body serialization and `serverFn` bundling so repeated pipeline builds don't re-parse/re-bundle
- The `no-impure-function-body` ESLint rule now also analyzes bodies passed by identifier reference, flags a closure that shadows a server-global name, and rejects nested async/generator/dynamic-import — kept in lockstep with the runtime check by a shared conformance corpus. The pre-commit hook builds before linting so the rule can't be silently skipped
- `@pipesafe/function-bundler` resolves the default export of a CommonJS module (`module.exports = fn`)
- `new Project()` surfaces a model's `$function` build failure as an aggregated validation error instead of crashing mid-construction
- Body argument typing: an optional field (`age?: number`) is now passed to the body as `number | null` — a missing field reaches the body as `null`, so the previous `number` typed bodies that threw on documents without the field
- Purity check: the `__name` helper that tsx / esbuild `keepNames` inject into bodies with nested named functions, function-valued consts, or classes is shimmed instead of being rejected as a free variable
- `MONGO_SERVER_GLOBALS` no longer lists `Promise` (bodies are synchronous; it was already documented as excluded)
