# elements/ — type-system building blocks

Schema-parameterized primitives consumed by every stage: field selectors/
references, literals, the operand kernel, and the expression registry.

## The expression registry (expressions.ts)

`ExpressionSpec<Schema>` is the single registration point. To add an operator:

1. Add one registry entry: `$op: { operand: <shape>; returns: <type> }`.
   Build operand shapes from the kernel (`ExpressionOperand`/`ArrayOperand`/
   `ArithmeticPair`/...) so the brand message comes via `RequiresMsg`.
2. If the operator belongs in a category union (`StringExpression` etc.),
   add its key to the matching key-set alias (`StringOps` etc.).
3. Only if the RESULT depends on the literal arguments: add the key to
   `LiteralDependentOps` AND an arm to `InferDependentExpression` (keep them
   in lockstep; a missed entry degrades to the registry's declared
   `returns`, never to a wrong type).

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

`cd packages/core && bunx tsc --noEmit` is the gate that checks the
`*.typeAssertions.ts` files (the root `bun run typecheck` does NOT re-check
package sources). Inspect resolved types with
`bun run tsx .claude/inspect-types.ts <TypeName> src/path/file.ts` from the
package directory.
