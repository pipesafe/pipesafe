---
"@pipesafe/function-bundler": minor
---

Initial release: bundles file-based `$function` bodies (referenced via `@pipesafe/core`'s `serverFn()`) into self-contained scripts for MongoDB server-side execution. esbuild-powered: TypeScript parsed natively, imports inlined, tree-shaken; unresolvable imports and Node builtins fail loudly at pipeline-build time. Optional peer of `@pipesafe/core` — only needed when using file-based bodies.
