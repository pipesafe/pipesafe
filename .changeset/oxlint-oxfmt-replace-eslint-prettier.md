---
"@pipesafe/core": patch
---

Tooling only, no published surface: ESLint and Prettier are replaced by oxlint and oxfmt. The sources are reformatted because oxfmt has no `experimentalTernaries` equivalent, and linting is now genuinely type-aware (via `oxlint-tsgolint`), which the old ESLint config claimed but did not do (#114).
