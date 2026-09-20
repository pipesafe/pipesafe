---
"@pipesafe/core": patch
---

Tooling only, no published surface: ESLint and Prettier are replaced by oxlint and oxfmt. The sources are reformatted because oxfmt has no `experimentalTernaries` equivalent, and linting is now genuinely type-aware (via `oxlint-tsgolint`), which the old ESLint config claimed but did not do (#114). typescript-eslint's `strictTypeChecked` set is enabled by name, on top of oxlint's own `correctness`, `suspicious`, `pedantic` and `perf` categories. Nothing is switched off: the findings that already existed are carried in `oxlint-suppressions.json`, which only ever shrinks.
