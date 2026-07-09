---
"@pipesafe/core": minor
---

Export runtime operator-name lists: grouped match matcher arrays (with `FIELD_MATCH_OPERATORS` / `TOP_LEVEL_MATCH_OPERATORS` spread combinations), per-category expression operator arrays (with the `EXPRESSION_OPERATORS` spread), and `ACCUMULATOR_OPERATORS`. The operator-key unions are now derived from these arrays and pinned against the registries by type assertions.
