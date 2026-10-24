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
  dotted paths brand at the chained call site), binders nested inside
  other operators (`$size: { $filter: … }`, `$sum: { $map: … }`) are walked
  too, `$concat` requires string-RESOLVING variables (`"$$ROOT.name"`
  passes, `"$$NOW"` brands — a real MongoDB runtime error) and accepts
  nested string-returning expressions (`{ $toUpper: "$name" }`), and
  `$map`/`$filter` inputs keep their array-operand demand for `$`-refs and
  `$$`-variables.
- Typed operand positions accept system variables by their accurate type
  (`$dateAdd: { startDate: "$$NOW", ... }`, `$map: { input: "$$USER_ROLES" }`),
  and `$cond`/`$ifNull`/comparison operands accept the enumerated system
  variables (`$gte: ["$expiresAt", "$$NOW"]`).
- `$map.as` is now optional (MongoDB defaults the binding to `$$this`).
- `$$REMOVE` drops the field: a `$cond`/`$ifNull` branch of `"$$REMOVE"`
  infers `| undefined`, and `$project: { f: "$$REMOVE" }` (top level or
  nested) omits `f` from the output.
- `$$`-references resolve through the bound `Vars` environment (binder and
  lookup-let bindings) first, then `SystemVariableSpec`, with the same
  dotted-path handling either way. `SystemVariableReferences<Schema>` and
  `VariableReferences<Vars>` are the finite `$$` vocabularies, so dotted
  variable paths are accepted and autocomplete at top-level value positions:
  `$set: { n: "$$ROOT.name" }`,
  `$group: { latest: { $max: "$$ROOT.joinedAt" } }`, and typed operands
  accept `"$$ROOT.price"`-style dotted rewrites.
- `$lookup` supports `let`: binding values are validated and inferred
  against the OUTER schema/environment, the bindings become the
  sub-pipeline builder's environment (`Pipeline`'s new `Env` generic), and
  inside the sub-pipeline `$$ROOT`/`$$CURRENT` resolve to the FOREIGN
  schema, matching MongoDB's scoping. Binding names (`let` and `$let.vars`
  keys, `$map`/`$filter` `as`) follow MongoDB's rule: non-empty, starting
  with a lowercase letter or non-ASCII character, and containing only
  `[_a-zA-Z0-9]` or non-ASCII characters (`"my-var"` brands).
  Bound names autocomplete inside the sub-pipeline (`"$$order_qty"`),
  resolve to accurate types, and out-of-scope `$$`-names reject.
  Nested lookups inherit outer bindings; `$unionWith`/`$facet`
  sub-builders propagate the environment.
- `$sum`/`$avg`/`$min`/`$max` type-check `$$`-variable operands against
  their resolved type (`$sum: "$$NOW"` brands; `$sum: "$$ROOT.qty"` passes).
- A lookup or unionWith sub-pipeline that ends in `.group()` no longer
  fails with "Type instantiation is excessively deep".
- `$set`/`$group`/`let` validation no longer walks the full expression
  registry once per schema, cutting type-check instantiations by about 40%.
