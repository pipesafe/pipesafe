import { Document, IndexStr, Join, NonExpandableTypes } from "../utils/core";

// Types related to field selectors
// These are used in $match stages as KEYS of documents
// They are NOT prefixed with a $, but do allow array item selection by index

export type PathsIncludingArrayIndexes<T> =
  // If T is an array, allow indices and recurse into element type
  T extends (infer U)[] ?
    | IndexStr<T>
    | (PathsIncludingArrayIndexes<U> extends infer P extends string ?
        Join<IndexStr<T>, P> | P
      : never)
  : // If T is a non-function object, include each key and deeper subpaths
  T extends object ?
    T extends NonExpandableTypes ?
      never
    : {
        [K in Extract<keyof T, string>]:
          | K
          | (PathsIncludingArrayIndexes<T[K]> extends infer P extends string ?
              Join<K, P>
            : never);
      }[Extract<keyof T, string>]
  : never;

export type FieldSelector<S extends Document> = PathsIncludingArrayIndexes<S>;

export type GetFieldType<Schema, Path extends string> =
  // Case 1: Schema is an array
  Schema extends (infer U)[] ?
    Path extends `${infer Index}.${infer Rest}` ?
      Index extends `${number}` ?
        GetFieldType<U, Rest> // Numeric index with more path - continue with element
      : GetFieldType<U, Path> extends (
        infer R // Non-numeric - field access on elements
      ) ?
        R extends never ?
          never
        : R[]
      : never
    : Path extends `${number}` ?
      U // Direct numeric index returns element
    : GetFieldType<U, Path> extends (
      infer R // No dots - field access on elements
    ) ?
      R extends never ?
        never
      : R[]
    : never
  : // Case 2: Schema is an object (not an array)
  Path extends keyof Schema ?
    Schema[Path] // Direct property access
  : Path extends `${infer Head}.${infer Tail}` ?
    Head extends keyof Schema ?
      GetFieldType<Schema[Head], Tail> // Recurse into property
    : never
  : never;

// Infer the type of a field at a given selector
// If traversing an array *without* an index, return an array of the nested field type
export type InferFieldSelector<
  Schema extends Document,
  Selector extends FieldSelector<Schema>,
> = GetFieldType<Schema, Selector>;

export type FieldSelectorsThatInferTo<Schema extends Document, DesiredType> = {
  [K in FieldSelector<Schema>]: InferFieldSelector<Schema, K> extends (
    DesiredType
  ) ?
    K
  : never;
}[FieldSelector<Schema>];

// ============================================================================
// Top-Level Fields (excludes dotted paths)
// ============================================================================

/** Excludes any string containing a dot (nested path) */
export type TopLevelField<T extends string> =
  T extends `${string}.${string}` ? never : T;
