---
"@pipesafe/core": minor
---

Register the date-part expression operators — `$year`, `$month`, `$dayOfMonth`, `$dayOfWeek`, `$dayOfYear`, `$hour`, `$minute`, `$second`, `$millisecond`, `$week`, `$isoDayOfWeek`, `$isoWeek` and `$isoWeekYear` — each accepting either a bare date expression or the `{ date, timezone }` object form, and each inferring `number`. They were previously on the `UnimplementedExpressionOps` allow-list, so they compiled but resolved to the expression object rather than to their result: `{ _id: { bucket: { $hour: { date: "$ts", timezone } } } }` gave `_id.bucket` the operand shape instead of `number`, and the rows could not be asserted to a row type without a detour through `unknown` (#116).
