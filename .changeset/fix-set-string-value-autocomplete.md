---
"@pipesafe/core": minor
---

`$set` string values now autocomplete: field references and the enumerated `$$` system variables (new `SYSTEM_VARIABLES` export) are suggested at string-value positions. `SetValue`'s string arms are all finite — the wide `` `$${string}` `` catch-all is gone, so a typo'd reference now fails at the call with a "Did you mean" suggestion, and an unlisted `$$variable` is rejected (undefined variables are MongoDB runtime errors; `$let`/`$map`/`$filter`-bound user variables remain accepted inside their operand interiors).
