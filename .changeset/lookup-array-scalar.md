---
"@pipesafe/core": minor
---

Allow `$lookup` between mismatched array/scalar field types. MongoDB's `$lookup` matches `localField` against `foreignField` element-wise: if either field is an array, each element gets matched as a scalar. PipeSafe's `Pipeline.lookup` previously only accepted `T = T` exactly, rejecting all three other valid combinations. The constraint now covers all four:

- `T` ↔ `T` (already worked)
- `T[]` → `T` (array localField, scalar foreignField)
- `T` → `T[]` (scalar localField, array foreignField)
- `T[]` ↔ `T[]` (already worked)

The element-strip arm uses `(infer Element)[]` so the same logic handles primitive arrays AND arrays of complex objects, plus dotted paths whose inferred type is array-shaped (e.g. `"a.b"` on `{ a: { b: string }[] }` resolves to `string[]`).

Strict expansion — no previously-accepted lookup is rejected. Coverage in `lookup.typeAssertions.ts`.
