---
"@pipesafe/core": patch
---

Dotted `$lookup` `as` paths now nest in the output schema. MongoDB writes
`as: "user.orders"` as `{ user: { orders: [...] } }` (preserving `user`'s
sibling fields, overwriting only the target path — the semantics of a
`$set` on that path), but `ResolveLookupOutput` typed it as a flat
`"user.orders"` literal key. The resolver now reuses `$set`'s dotted-key
machinery (`FlattenDotSet` + `ApplySetUpdates`); flat keys are unchanged.
`$graphLookup` inherits the fix through its delegation.
