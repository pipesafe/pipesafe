/**
 * Dotted-path machinery: expanding `"a.b.c"` keys into nested object
 * structure and flattening dot-set queries.
 */

import {
  ExcludeUndefined,
  MergeNested,
  Prettify,
  UnionToIntersection,
} from "./objects";

/**
 * Tail-recursive path splitter (spec §3.5 Pattern C): the accumulator makes
 * the recursion eligible for TS's tail-recursion elimination (~1000-depth
 * budget instead of ~50), so deep dotted paths no longer need hand-batched
 * 2-levels-per-step parsing.
 */
export type SplitPath<S extends string, Acc extends string[] = []> =
  S extends `${infer Head}.${infer Tail}` ? SplitPath<Tail, [...Acc, Head]>
  : [...Acc, S];

/** Fold segments into nested single-key objects, innermost-out (tail-recursive). */
type BuildNestedFromSegments<Segs extends readonly string[], Value> =
  Segs extends [...infer Rest extends string[], infer Last extends string] ?
    BuildNestedFromSegments<Rest, { [K in Last]: Value }>
  : Value;

export type ExpandDottedKey<
  Key extends string,
  Value,
> = BuildNestedFromSegments<SplitPath<Key>, Value>;

// Check if a type has any dotted keys (keys containing a dot)
export type HasDottedKeys<T> =
  {
    [K in keyof T]: K extends string ?
      K extends `${string}.${string}` ?
        true
      : never
    : never;
  }[keyof T] extends never ?
    false
  : true;

// Given a type T, removes keys that are string-literal "dot syntax" keys (e.g. "a.b").
// Only keeps the non-dotted (plain) keys.
export type RemoveDottedKeys<T> = {
  [K in keyof T as K extends string ?
    K extends `${string}.${string}` ?
      never
    : K
  : K]: T[K];
};

// Merge expanded objects. Uses UnionToIntersection internally for
// correctness: a purely iterative MergeNested would be order-dependent for
// optional fields and nested structures, whereas UnionToIntersection merges
// all expanded objects simultaneously (commutative).
type MergeExpandedObjectsIterative<T> =
  T extends Record<string, any> ?
    {
      [K in keyof T]: T[K];
    } extends infer ExpandedMap ?
      ExpandedMap extends Record<string, any> ?
        // Extract all expanded objects as a union and merge simultaneously
        UnionToIntersection<ExcludeUndefined<ExpandedMap[keyof ExpandedMap]>>
      : never
    : never
  : {};

// Expands all dotted keys into nested objects and merges them together.
// Excludes undefined to handle optional properties correctly (TS adds
// `| undefined` to indexed access of optional properties).
type ExpandAllDottedIterative<T> =
  {
    [K in keyof T]: K extends string ? ExpandDottedKey<K, T[K]> : never;
  } extends infer Expanded ?
    Expanded extends Record<string, any> ?
      MergeExpandedObjectsIterative<Expanded>
    : never
  : never;

// Flattens dot-nested keys (like "a.b": x) into nested object structure, merging as necessary.
// E.g. { a: { b: "first" }, "a.c": "last" } => { a: { b: "first", c: "last" }}
// Main utility:
// 1. Expands any dotted keys in T to their nested structure,
// 2. Merges expanded structure into original object (non-dotted keys win for those keys),
// 3. Removes original dotted keys from output.
// (Optimization history — alias-caching experiments, batched vs iterative
// expansion comparisons — lives in git history.)

// Two-phase processing: separate dotted and non-dotted keys so each path can
// be optimized independently.
type SeparateKeys<T> = {
  dotted: Pick<T, Extract<keyof T, `${string}.${string}`>>;
  nonDotted: Omit<T, Extract<keyof T, `${string}.${string}`>>;
};

export type FlattenDotSet<T> =
  SeparateKeys<T> extends infer Separated ?
    Separated extends { dotted: infer D; nonDotted: infer N } ?
      Prettify<
        N & // Non-dotted keys pass through
          RemoveDottedKeys<MergeNested<{}, ExpandAllDottedIterative<D>>>
      >
    : never
  : never;
