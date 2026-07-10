/**
 * Compile-time error brand machinery.
 *
 * Everything user-facing about PipeSafe's type errors flows through the
 * `PipeSafeError` brand defined here; `PassThrough` is the first early exit
 * every stage resolver wraps itself in.
 */

/**
 * Branded compile-time error type used to surface helpful messages in IDE
 * hovers instead of letting invalid input degrade silently to `never`.
 *
 * Single-parameter brand: the literal `Msg` is the entire surface area.
 * Embed dynamic context (path segments, key names, operator names,
 * field-type info) directly into the message via template literals
 * rather than carrying a separate `Ctx` — that way the hover shows
 * just the message string, not a wide schema dump.
 */
export interface PipeSafeError<Msg extends string> {
  readonly "~pipesafe.error": Msg;
}

/**
 * Predicate that returns `true` if `T` is a `PipeSafeError`, else `false`.
 * Used by helpers that need to short-circuit when a branded error has
 * already surfaced upstream.
 */
export type IsPipeSafeError<T> = T extends PipeSafeError<string> ? true : false;

/**
 * Short-circuit primitive: if `T` is a `PipeSafeError`, returns `T` unchanged;
 * otherwise returns `Result`. Wrap stage outputs and Pipeline method return
 * types with `PassThrough<Schema, ...>` so once an error appears in the chain,
 * downstream stages preserve it verbatim instead of producing fresh failures.
 *
 * Distributes over unions: `PassThrough<A | PipeSafeError<...>, R>` produces
 * `R | PipeSafeError<...>` (intentional — error branches survive while valid
 * branches still get computed).
 */
export type PassThrough<T, Result> =
  T extends PipeSafeError<string> ? T : Result;

/**
 * Shared template for the "requires" family of brand messages, enforcing the
 * CLAUDE.md message skeleton structurally:
 *
 *   Operator '$op' requires <constraint>.
 *   Accumulator '$op' requires <constraint>.
 *   Stage '$stage' requires <constraint>.
 *
 * Message wording stays at each operand helper's call site; only the
 * skeleton is shared.
 */
export type RequiresMsg<
  Subject extends "Operator" | "Accumulator" | "Stage",
  Op extends string,
  What extends string,
> = `${Subject} '${Op}' requires ${What}.`;

/**
 * THE exactly-one-operator brand — MongoDB rejects expression objects with
 * more than one operator key ("an expression specification must contain
 * exactly one field"). Referenced by InferExpression and every Validate
 * layer so the message is spelled once.
 */
export type MultiOperatorError =
  PipeSafeError<"Expression objects must have exactly one operator.">;

/**
 * Brand for a `$`-key that is neither registered (ExpressionSpec) nor on
 * the UnimplementedExpressionOps allow-list — i.e. a typo'd or nonexistent
 * operator. Valid-but-unmodeled MongoDB never reaches this: it is
 * allow-listed by name (elements/expressions.ts).
 */
export type UnknownOperatorError<Op extends string> =
  PipeSafeError<`Operator '${Op}' is not a recognized aggregation operator.`>;

/**
 * Accumulator sibling of UnknownOperatorError — a $group field's operator
 * key that is neither in AccumulatorSpec nor on the
 * UnimplementedAccumulators allow-list (stages/group.ts).
 */
export type UnknownAccumulatorError<Op extends string> =
  PipeSafeError<`Accumulator '${Op}' is not a recognized accumulator.`>;

/**
 * THE unknown-field brand — a field selector/reference/projection key that
 * doesn't resolve on the schema. Referenced by GetFieldTypeOrError,
 * GetFieldTypeWithoutArrays, and project's key check so the message is
 * spelled once.
 */
export type UnknownFieldError<Path extends string> =
  PipeSafeError<`Field '${Path}' is not on the schema.`>;

/**
 * An unlisted `$$`-variable — not one of the enumerated SYSTEM_VARIABLES
 * (elements/literals.ts) and not bound in the `Vars` environment the
 * enclosing `$let`/`$map`/`$filter` walks thread down
 * (ValidateVariableReference, elements/literals.ts).
 * Aggregation-command-level `let` variables are not modeled yet.
 */
export type UnknownSystemVariableError<Name extends string> =
  PipeSafeError<`Variable '${Name}' is not a recognized system variable.`>;
