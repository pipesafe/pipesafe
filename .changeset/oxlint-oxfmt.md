---
---

Linting and formatting move to oxlint and oxfmt. Linting is type-aware (via `oxlint-tsgolint`), with strict type-checked rules on top of oxlint's `correctness`, `suspicious`, `pedantic` and `perf` categories. Existing findings are carried in `oxlint-suppressions.json`, which only shrinks. Sources are reformatted by oxfmt.
