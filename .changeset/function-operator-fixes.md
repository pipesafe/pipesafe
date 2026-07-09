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
- `Promise` removed from `MONGO_SERVER_GLOBALS`: the server engine is synchronous and never resolves a returned Promise, so bodies referencing it are now rejected up front (matching the existing async/generator rejection)
- `$function` runtime support (`serializeFunction.ts`, `mongoServerGlobals.ts`, the purity corpus) moved from `src/utils/` to `src/function-helpers/` — no public API change; all entry-point exports are unchanged
- The runtime purity check and the `no-impure-function-body` ESLint rule now execute ONE shared analysis (`function-helpers/analyzeFunctionBody.ts`), so the editor error and the runtime error cannot drift; the lint rule keeps one additive scope-aware check the runtime is structurally blind to (a closure shadowing a server-global name). Two scoping bugs fixed in the process: a function declaration in a nested block is now correctly block-scoped (strict semantics — previously Annex-B-hoisted and wrongly accepted), and a default parameter referencing a later parameter is no longer misreported as an outer-scope variable
- The native/bound-function guard is anchored to the whole source, so a body whose code merely contains the text `{ [native code] }` in a string literal is no longer rejected
- `$function`-free stages skip the serialization walk entirely (allocation-free boolean probe), removing the per-stage rebuild cost from pipelines that never use `$function`
- `serverFn` bundle caching is revalidated against a content hash of every file in the bundle (entry + transitive imports), so editing a server module in a long-lived process takes effect on the next build instead of serving a stale bundle; `bundleServerFunction` now returns `{ code, inputs }`
- A `Model`'s pipeline is built at most once per instance and cached — discovery, validation, and execution all consume the same artifact (the DAG that was validated is provably the pipeline that runs), and each `$function` body is parsed/bundled once instead of once per consumer. `Project.validate()` now genuinely reports `build_error` for models whose pipeline fails to build
