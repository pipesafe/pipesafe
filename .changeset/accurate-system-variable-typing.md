---
"@pipesafe/core": minor
---

Accurate types for `$$`-system variables and `$let`/`$map`/`$filter` bound variables

- `SystemVariableSpec` maps every enumerated system variable to its accurate
  type: `$$NOW` → `Date`, `$$CLUSTER_TIME` → `Timestamp`, `$$ROOT`/`$$CURRENT`
  → the current document schema, `$$USER_ROLES` → the role-document array,
  `$$REMOVE` → `never` (field-dropping semantics). Inference everywhere
  (`$set`/`$project`/`$group`/`replaceRoot`) now resolves system variables to
  these types instead of `unknown`, including dotted paths like
  `"$$ROOT.name"`.
- `$let` and `$map` are now literal-dependent: `$let` infers its `in`
  expression with the `vars` block bound (`"$$t"` resolves to the inferred
  type of `vars.t`), and `$map` infers its element-wise `in` result as an
  array, binding the element under the `as` name (default `"this"`). The
  variable environment threads through nested expressions, nested binders
  shadow outer bindings, and `$filter`'s element type flows the same way.
- Validation matches inference: binder interiors are walked with their
  bindings (bad refs in `vars`, unknown `$$`-names in `in`/`cond`, and bad
  dotted paths brand at the chained call site), `$concat` now requires
  string-RESOLVING variables (`"$$ROOT.name"` passes, `"$$NOW"` brands —
  a real MongoDB runtime error), and `$map`/`$filter` inputs keep their
  array-operand demand for `$`-refs and `$$`-variables.
- Typed operand positions accept system variables by their accurate type
  (`$dateAdd: { startDate: "$$NOW", ... }`, `$map: { input: "$$USER_ROLES" }`),
  and `$cond`/`$ifNull`/comparison operands accept the enumerated system
  variables (`$gte: ["$expiresAt", "$$NOW"]`).
- `$map.as` is now optional (MongoDB defaults the binding to `$$this`).
- ONE variable environment: `SystemVariables<Schema>` seeds every `Vars`
  parameter, binders extend it, and resolution is a single lookup —
  system and user variables are not separate code paths.
  `VariableReferences<Vars>` derives the finite `$$` acceptance
  vocabulary, so dotted variable paths are first-class at top-level value
  positions and in completions: `$set: { n: "$$ROOT.name" }`,
  `$group: { latest: { $max: "$$ROOT.joinedAt" } }`, and typed operands
  accept `"$$ROOT.price"`-style dotted rewrites.
- `$lookup` supports `let`: binding values are validated and inferred
  against the OUTER schema/environment, the bindings become the
  sub-pipeline builder's environment (`Pipeline`'s new `Env` generic), and
  every sub-pipeline stage reseeds `$$ROOT`/`$$CURRENT` to the FOREIGN
  schema — matching MongoDB's scoping, verified against a real server.
  Bound names autocomplete inside the sub-pipeline (`"$$order_qty"`),
  resolve to accurate types, and out-of-scope `$$`-names reject.
  Nested lookups inherit outer bindings; `$unionWith`/`$facet`
  sub-builders propagate the environment.
