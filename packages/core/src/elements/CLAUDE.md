# elements/ — type-system building blocks

Schema-parameterized primitives consumed by every stage: field selectors/
references, literals, the operand kernel, the expression registry, and the
nested-validation kernel (`validation.ts` — THE rejection surface for
structurally-accepted `$`-shapes; `never` = valid, anything else is the
branded replacement; unimplemented-but-valid operators are allow-listed BY
NAME in `UnimplementedExpressionOps` — names outside registry + allow-list
brand as typos).

## The expression registry (expressions.ts)

`ExpressionSpec<Schema>` is the single registration point. To add an operator:

1. Add one registry entry: `$op: { operand: <shape>; returns: <type> }` —
   and DELETE `$op` from `UnimplementedExpressionOps` (the by-name
   allow-list of valid-but-unmodeled operators; never widen it to
   `` `$${string}` ``).
   Build operand shapes from the kernel (`ExpressionOperand`/`ArrayOperand`/
   `ArithmeticPair`/...) so the brand message comes via `RequiresMsg`.
   Operand ARRAY/TUPLE positions must be `readonly` (mutable AND `as const`
   operands both relate to a readonly target; a mutable position makes
   const-typed operands fail the Validate re-check). If the operator gets
   an `InferDependentExpression` arm, its tuple PATTERNS must be readonly
   too, or `<const>`-inferred readonly literals fall through the arm and
   the resolver silently drops the field.
2. Add the operator to its `*_EXPRESSION_OPERATORS` const array — the
   AUTHORITATIVE category declaration. The union paired under each array,
   the spread `EXPRESSION_OPERATORS`, and the category unions
   (`StringExpression` etc.) all derive from the arrays — never sync them
   with assertion pins. The spread's `satisfies` surfaces a missing
   registry entry at the array declaration; a registry key absent from
   the arrays is caught by the completions suite's exact-match ideals.
3. Only if the RESULT depends on the literal arguments: OMIT `returns`
   from the entry (the omission IS the declaration — `LiteralDependentOps`
   is derived from it) and add an arm to `InferDependentExpression`. TS
   has no type-level lambdas, so the arm is the irreducible per-operator
   inference code; a missing arm degrades to `unknown`, never to a wrong
   type or a dropped field. `_DerivedLiteralDependentOps` pins the set.

Everything else (per-operator types, `Expression`, fixed-return inference)
derives automatically. Do NOT hand-write expression object types.

## Dispatch rules (utils/dispatch.ts kernel)

- Classify values by `$`-key presence (`OperatorKeyOf`/`HasOperatorKey`)
  BEFORE any schema-parameterized work. Never use
  `extends Expression<Schema>` / `extends FieldReference<Schema>` to pick a
  branch in inference positions — those unions are expensive to instantiate
  and the `$`-prefix is a sound discriminator (MongoDB forbids stored
  `$`-keys).
- Inference is FORGIVING: a malformed operand keeps the operator's declared
  result kind; the operand brand reports at the input position. Don't "fix"
  this by making inference fail on bad operands.
- `NotAnExpression` (sentinel, not `never`) means "treat as literal".

## Completion safety

Completion lists are API surface, pinned exactly by
`packages/core-completions-tests`. The four invariants (no wide templates
next to finite literal unions, no `& {}` string intersections, no bare
non-plain object types in object-completed unions, `FieldSelectorKeys`
hints for index-signature queries) live in the root CLAUDE.md — read them
before touching any Query/operand union.

- `ResolveToPrimitive`'s literal-value arm carries Date/ObjectId as the
  keyless `object` — `{}` is NOT equivalent (it accepts primitive strings
  and breaks the replaceRoot `"$missing"` rejection pin).
- There is ONE variable-threading mechanism: `SystemVariables<Schema>`
  (literals.ts — derived from `SystemVariableSpec`, which carries each
  variable's ACCURATE type: $$NOW → Date, $$ROOT → Schema, $$REMOVE → the
  load-bearing `never`) is the DEFAULT of every `Vars` parameter;
  `$let`/`$map`/`$filter` binding arms extend it (BindLetVars/BindVariable
  in expressions.ts — shared by inference and validation, so the two
  environments cannot diverge), and `$lookup.let` reseeds it over the
  foreign schema via Pipeline's `Env` generic (PipelineVars).
  `InferVariableReference`/`ValidateVariableReference` resolve `"$$name"`/
dotted`"$$name.path"`by a single env lookup; unlisted/unbound names
brand with`UnknownSystemVariableError`. `VariableReferences<Vars>` is
  the env's finite acceptance vocabulary. The env-merge types
  (PipelineVars/ResolveLookupLetEnv/BindLetVars/BindVariable) are ONE
  mapped type each with lazy values — Omit/Prettify spellings stack
  instantiation layers at the deepest point of lookup-lambda checking and
  tripped TS2589.
- The validation kernel's binder-interior (forgiving) branches run the
  Vars-blind registry relation as FAST-ACCEPT ONLY, then walk. The
  fast-accept doubles as the cycle breaker: without it, exploration with
  the registry's own wide shapes recurses registry→operand-union→registry
  until TS's depth limiter (TS2589 at every lookup-let sub-pipeline
  stage).
- ValidateArrayInputValue's non-`$`-string arm RELATES against the
  registry's input operand; do NOT "improve" it into a ValidateNestedValue
  re-entry — $filter is a member of ArrayProducingExpression (hence of
  every ArrayOperand), and the walk re-entry from that position measurably
  blows TS's instantiation-depth budget (TS2589 on unrelated `.set()` call
  sites).

## Gotchas

- `InferNestedFieldReference` is the hottest path in the library (every
  value of every $set/$project/$group literal). Keep its arms cheap.
- `SchemaRefTypeMap` must be applied AFTER `Schema extends unknown`
  distribution. A defaulted parameter computed from `Schema` is unsound for
  union schemas: defaults substitute before the body distributes.
- Distribution only happens over NAKED type parameters. Inlining the
  UnionToIntersection trick over an alias application silently doesn't
  distribute — route through the generic alias (this was a real bug, caught
  by stages.contract.typeAssertions.ts).
- `GetFieldTypeWithoutArrays` brands unknown paths; its selector twin
  `GetFieldType` (fieldSelector.ts) returns `never` deliberately — that
  `never` is load-bearing for union narrowing in match.

## Verifying changes

`bun run typecheck:packages` (from the root) is the gate that checks the
`*.typeAssertions.ts` files (the root `bun run typecheck` does NOT re-check
package sources). Inspect resolved types with
`bun run tsx .claude/inspect-types.ts <TypeName> src/path/file.ts` from the
package directory.
