---
"@pipesafe/core": patch
---

Tooling only, no published surface: ESLint is replaced by oxlint, with typescript-eslint's `strictTypeChecked` set enabled by name and genuinely type-aware (via `oxlint-tsgolint`), which the old ESLint config claimed but did not do (#114). Prettier stays as the formatter. The findings the tree does not pass yet are carried in `oxlint-suppressions.json` rather than switched off in the config.
