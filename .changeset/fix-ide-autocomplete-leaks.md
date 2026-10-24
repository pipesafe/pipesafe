---
"@pipesafe/core": minor
---

Fix IDE autocomplete across Pipeline call sites: match string/Date fields no longer leak RegExp/Date methods (symbol-keyed exact-value arms), `$elemMatch` offers element fields plus matchers and now accepts per-field element queries (`{ $elemMatch: { qty: { $gt: 5 } } }`), `$set`/`$project` suggest existing field selectors as keys while keeping arbitrary new keys legal, expression/accumulator value objects suggest only their operators (Date/ObjectId methods no longer leak), and `$group`'s `_id` suggests and accepts references to array/document fields (`{ _id: "$shipping" }`).
