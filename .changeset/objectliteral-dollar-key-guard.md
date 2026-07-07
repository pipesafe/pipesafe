---
"@pipesafe/core": patch
---

Reject `$`-keyed objects as literals. Previously a `$`-keyed object (an
expression) was vacuously assignable to the `ObjectLiteral` pattern index
signature, so invalid expressions slipped through `$set`/`$project` silently
as "literals" — e.g. `.set({ total: { $add: ["$stringField", 1] } })`
compiled. Top-level invalid expressions now fail at the call site. Nested
computed values keep working via a structural expression-shaped arm (operand
strictness for nested positions arrives with the per-stage validation
layer). Also removes the dead `ResolveToPrimitiveObject`/
`ResolveToPrimitiveArray`/`ResolveToPrimitiveObjectArray` types (no
consumers, never exported).
