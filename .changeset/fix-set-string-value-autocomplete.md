---
"@pipesafe/core": minor
---

`$$`-system variables are now an enumerated vocabulary (new `SYSTEM_VARIABLES` export) accepted and autocompleted wherever the wide `$$` namespace used to be: `$set`/`$project` string values (which now also autocomplete field references), `$group` `_id` and accumulator operands, `$replaceRoot`'s `newRoot` (previously rejected system variables entirely), and the nested-validation kernel. An unlisted `$$variable` is rejected — as an `UnknownSystemVariableError` brand in nested positions or a "Did you mean" constraint error at top level — while `$let`/`$map`/`$filter`-bound user variables remain accepted inside the operand interiors that bind them. Aggregation-command-level `let` variables are not modeled yet.
