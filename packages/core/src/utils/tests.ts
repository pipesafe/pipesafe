import { Prettify } from "./core";

// Generic type equality assertion - compile-time only
// Uses exact type equality check (works correctly with unions)
export type Equal<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? true
  : false;

// Helper to create a compile-time type assertion that errors on the second param
export type Assert<T extends true> = T;
export type ExpectAssertFailure<T extends false> = T;

// Helper to check if a type is assignable to another type
export type IsAssignable<T, U> = T extends U ? true : false;

/**
 * NotImplemented - Marks a type assertion as not yet implemented
 *
 * This type requires that the input assertion is `false` (not implemented).
 * If the assertion is `true` (already working), it will error to indicate
 * that the feature is actually implemented and should not use NotImplemented.
 *
 * Usage: Assert<NotImplemented<Equal<ActualType, ExpectedType>>>
 *
 * The type evaluates to `true` only when T extends false, ensuring that
 * NotImplemented is only used for features that are not yet implemented.
 *
 * @deprecated This feature is not yet implemented. The type assertion will pass
 * but the actual implementation needs to be completed.
 */
export type NotImplemented<T extends false> = true & {
  /**
   * @deprecated This feature is not yet implemented
   *
   * The type assertion passes, but the runtime implementation
   * needs to be completed. Check the test file for expected behavior.
   */
  readonly __notImplemented: "This feature needs to be implemented";
  /**
   * The original assertion that was wrapped - preserved for reference
   */
  readonly __originalAssertion: T;
};

// Function-based type assertion that causes actual compiler errors
export function expectType<T>(_value: T): void {}

// Helper to check exact type equality
type IfEquals<T, U, Y = unknown, N = never> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? Y : N;

// Create a type error message that shows the actual vs expected types
type TypeMismatchError<Actual, Expected> = {
  error: "Type mismatch detected!";
  actual: Actual;
  expected: Expected;
  message: "The actual type does not match the expected type";
};

// Type assertion that causes compiler error when types don't match
// Now shows the actual types in the error message instead of just 'never'
export function assertTypeEqual<T, U>(
  _actual: IfEquals<
    Prettify<T>,
    Prettify<U>,
    T,
    TypeMismatchError<Prettify<T>, Prettify<U>>
  >,
  _expected: U
): void {}
