---
"@pipesafe/core": minor
---

Scalar stages now export their Query aliases (`LimitQuery`, `SkipQuery`,
`CountQuery`) and the corresponding `Pipeline` methods reference them,
completing the stage trio convention uniformly across all stages. No
behavioral change — the aliases resolve to the same scalar types the
methods already accepted.
