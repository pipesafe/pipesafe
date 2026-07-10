---
"@pipesafe/core": minor
---

Export the runtime operator-name vocabularies as authoritative const arrays: grouped match matcher arrays (with `FIELD_MATCH_OPERATORS` / `TOP_LEVEL_MATCH_OPERATORS` spread combinations), per-category expression operator arrays (with the `EXPRESSION_OPERATORS` spread and an `EXPRESSION_OPERATORS_BY_CATEGORY` record), and `ACCUMULATOR_OPERATORS`. The operator-key unions derive from these arrays by construction (`(typeof ARR)[number]`), and the registries conform to them via `satisfies` checks at the array declarations.
