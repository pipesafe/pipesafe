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
