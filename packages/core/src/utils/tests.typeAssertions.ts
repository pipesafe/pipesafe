import { IsPipeSafeError, PassThrough, PipeSafeError } from "./errors";
import { Assert, AssertPipeSafeError, Equal } from "./tests";

/**
 * Type-level tests for the foundation primitives introduced in Commit 1:
 * `PipeSafeError`, `IsPipeSafeError`, `PassThrough`, and `AssertPipeSafeError`.
 *
 * These pin the contract that every later phase relies on:
 * - `PipeSafeError` is recognised by `IsPipeSafeError`
 * - `PassThrough` short-circuits on error inputs and computes Result otherwise
 * - `PassThrough` distributes over unions (intentional — error branches survive
 *   while valid branches still get computed)
 * - `AssertPipeSafeError` matches the literal embedded message
 */

// ----------------------------------------------------------------------------
// IsPipeSafeError
// ----------------------------------------------------------------------------

type _IsErr_Branded = Assert<Equal<IsPipeSafeError<PipeSafeError<"x">>, true>>;
type _IsErr_PlainObject = Assert<Equal<IsPipeSafeError<{ x: number }>, false>>;
type _IsErr_Unknown = Assert<Equal<IsPipeSafeError<unknown>, false>>;
type _IsErr_String = Assert<Equal<IsPipeSafeError<"hello">, false>>;
type _IsErr_BrandedNoCtx = Assert<
  Equal<IsPipeSafeError<PipeSafeError<"y">>, true>
>;
// Note: IsPipeSafeError<never> distributes to `never`, not `false` — `never`
// is the bottom type and isn't a meaningful input to a runtime predicate.
// PassThrough handles never explicitly (see _PT_NeverInputProducesNever below).

// ----------------------------------------------------------------------------
// PassThrough — error short-circuits, valid input computes Result
// ----------------------------------------------------------------------------

type _PT_PreservesError = Assert<
  Equal<
    PassThrough<PipeSafeError<"oops">, { x: number }>,
    PipeSafeError<"oops">
  >
>;

type _PT_ComputesOnValid = Assert<
  Equal<PassThrough<{ a: 1 }, { b: 2 }>, { b: 2 }>
>;

type _PT_DistributesOverUnion = Assert<
  Equal<
    PassThrough<{ a: 1 } | PipeSafeError<"e">, { b: 2 }>,
    { b: 2 } | PipeSafeError<"e">
  >
>;

type _PT_NeverInputProducesNever = Assert<
  Equal<PassThrough<never, { b: 2 }>, never>
>;

// ----------------------------------------------------------------------------
// AssertPipeSafeError — message-equality probe
// ----------------------------------------------------------------------------

type _APSE_MatchingMessage = Assert<
  AssertPipeSafeError<PipeSafeError<"my message">, "my message">
>;

type _APSE_WrongMessage = Assert<
  Equal<
    AssertPipeSafeError<PipeSafeError<"my message">, "wrong message">,
    false
  >
>;

type _APSE_NotAnError = Assert<
  Equal<AssertPipeSafeError<{ x: number }, "anything">, false>
>;

export type {
  _IsErr_Branded,
  _IsErr_PlainObject,
  _IsErr_Unknown,
  _IsErr_String,
  _IsErr_BrandedNoCtx,
  _PT_PreservesError,
  _PT_ComputesOnValid,
  _PT_DistributesOverUnion,
  _PT_NeverInputProducesNever,
  _APSE_MatchingMessage,
  _APSE_WrongMessage,
  _APSE_NotAnError,
};
