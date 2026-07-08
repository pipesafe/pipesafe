/**
 * Object-level type combinators: the base `Document` type, display helpers,
 * union manipulation, and deep merging of plain objects.
 */

export type Document = Record<string, any>;

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type NonExpandableTypes = Function | { _bsontype: string } | Date;

export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I
  : never;

// Make a union of object types mutually exclusive: each branch is augmented
// with `?: never` for keys that exist in *other* branches but not its own,
// so a value satisfying multiple branches at once is rejected.
type AllKeys<T> = T extends unknown ? keyof T : never;

type _ExclusifyUnion<T, K extends PropertyKey> =
  T extends unknown ? Prettify<T & Partial<Record<Exclude<K, keyof T>, never>>>
  : never;

export type ExclusifyUnion<T> = _ExclusifyUnion<T, AllKeys<T>>;

// Filter out undefined from a union type
export type ExcludeUndefined<T> = T extends undefined ? never : T;

// Merge plain objects deeply (does NOT merge arrays/Date/etc.)
export type IsPlainObject<T> =
  T extends object ?
    T extends any[] ? false
    : T extends Function ? false
    : T extends Date ? false
    : T extends RegExp ? false
    : T extends { _bsontype: string } ? false
    : true
  : false;

// Helper to determine merge result for a key when both A and B have it
// Extracted to reduce conditional nesting depth in MergeNested
type MergeKeyValue<AVal, BVal> =
  [BVal] extends [never] ?
    never // If B has never, preserve it (for $$REMOVE)
  : IsPlainObject<AVal> extends true ?
    IsPlainObject<BVal> extends true ?
      MergeNested<AVal, BVal> // both plain objects: recurse
    : BVal
  : BVal; // B wins if not both objects (B has new value)

// Helper to check if two types have the same keys (cheaper than full extends check)
// This is a fast heuristic: if keyof A === keyof B, types might be identical
// (exported: updates.ts's reorder fast path is the other consumer — one
// spelling of the bidirectional-keyof predicate)
export type HaveSameKeys<A, B> =
  keyof A extends keyof B ?
    keyof B extends keyof A ?
      true
    : false
  : false;

// The single spelling of MergeNested's key-wise merge.
type MergeAllKeys<A, B> = Prettify<{
  [K in keyof A | keyof B]: K extends keyof B ?
    K extends keyof A ?
      MergeKeyValue<A[K], B[K]>
    : B[K]
  : K extends keyof A ? A[K]
  : never;
}>;

// Conditional early exit: only check for identical types when keys match —
// if keys differ the types can't be identical, so the expensive bidirectional
// extends check is skipped.
export type MergeNested<A, B> =
  HaveSameKeys<A, B> extends true ?
    // Keys match - check if types are identical (worth the check)
    [A] extends [B] ?
      [B] extends [A] ?
        A // Early exit: types are exactly identical
      : MergeAllKeys<A, B>
    : MergeAllKeys<A, B>
  : // Keys differ - skip expensive check, go straight to merge
    MergeAllKeys<A, B>;

/**
 * Forbid keys matching a template pattern: `{ [K in Pattern]?: never }`.
 * Load-bearing companion to pattern index signatures — a pattern index
 * constrains only MATCHING keys, so a shape meant to be "keys of pattern X
 * only" must also forbid the complement or every object with non-matching
 * keys is VACUOUSLY assignable (the ObjectLiteral vacuity bug class).
 */
export type ForbidKeys<Pattern extends string> = {
  [K in Pattern]?: never;
};

/**
 * Drop keys whose value is exactly `never`. THE key-filter for Validate
 * wrappers: apply to a full per-key validation map so a
 * fully-valid query filters to `{}` and the `Q & ValidateXxxQuery<...>`
 * intersection short-circuits on the happy path. The tuple wrapping is
 * load-bearing — a naked `M[K] extends never` distributes and keeps keys
 * whose validation is a union containing never.
 */
export type OmitNeverValues<M> = {
  [K in keyof M as [M[K]] extends [never] ? never : K]: M[K];
};
