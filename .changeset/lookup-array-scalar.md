---
"@pipesafe/core": minor
---

`$lookup` now accepts mismatched array/scalar field types (`T[] → T` and `T → T[]`), matching MongoDB's element-wise semantics. When no foreign field is compatible, the constraint surfaces a branded `PipeSafeError` instead of falling through to "is not assignable to never".
