---
"@pipesafe/core": minor
---

Add the `$function` aggregation expression operator with full type safety:

- `body` is a real TypeScript function; its `args` determine the parameter types (`"$age"` → `number`). At top-level keys of `$set`/`$project`/`$replaceRoot` unannotated params receive these types automatically; wrong annotations or wrong arity fail to compile at any nesting depth (inside `$add`, `$cond`, accumulators, even another `$function`'s args)
- The expression's result type is the body's return type (`undefined`/`void` normalize to `null`); a body returning `any` surfaces a `PipeSafeError` brand instead of leaking `any`, and nested unannotated params fail as TS7006 rather than becoming silent `any`
- Bodies are serialized at pipeline-build time with a free-variable purity check (acorn): closures, imports, async/generators, and non-server globals throw with the offending identifiers named
- New `@pipesafe/core/eslint-plugin` subpath export ships the `no-impure-function-body` rule for edit/CI-time enforcement (outer-scope references, async/generator bodies)
- New `serverFn()` helper references file-based bodies that MAY import helpers — bundled into self-contained scripts by the optional `@pipesafe/function-bundler` package
