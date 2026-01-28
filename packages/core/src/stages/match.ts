import {
  Document,
  UnionToIntersection,
  IsPlainObject,
  DollarPrefixed,
} from "../utils/core";
import {
  FieldSelector,
  GetFieldType,
  InferFieldSelector,
} from "../elements/fieldSelector";
import type { BSONType } from "bson";

type ElementMatcher = "$elemMatch";
type InMatchers = "$in" | "$nin"; // $in and $nin work for all types
type ArrayOnlyMatcher = "$all"; // $all only makes sense for arrays

type EqualityMatchers = "$eq" | "$ne";

type ContinuousMatchers = "$gte" | "$lte" | "$gt" | "$lt";

// MongoDB accepts both numeric codes (BSONType) and string aliases for $type operator
type BSONTypeAlias = keyof typeof BSONType;
type SomeBSONType = BSONType | BSONTypeAlias;

type MergeUnion<T> =
  IsPlainObject<T> extends true ?
    {
      [K in keyof UnionToIntersection<T>]: MergeUnion<
        UnionToIntersection<T>[K]
      >;
    }
  : T;

export type ComparatorMatchers<T extends unknown> = MergeUnion<
  /* Always */ {
    $exists?: boolean;
    $type?: SomeBSONType | SomeBSONType[];
  } & {
    [m in EqualityMatchers]?: T;
  } & {
    [m in InMatchers]?: T[];
  } & /* Numbers */ (T extends number ? { [m in ContinuousMatchers]?: number }
    : {}) &
    /* Dates */ (T extends Date ? { [m in ContinuousMatchers]?: Date } : {}) &
    /* Arrays */ (T extends (infer U)[] ?
      | { $size?: number }
      | { [m in ArrayOnlyMatcher]?: U[] }
      | { [m in ElementMatcher]?: U }
    : {}) &
    /* String */ (T extends string ? { $regex?: unknown } : {})
>;

export type RawMatchersForType<T extends unknown> =
  T extends (infer U)[] ?
    ComparatorMatchers<T> | RawMatchersForType<U> // Element matcher (passthrough)
  : ComparatorMatchers<T>;

export type Notted<T> = { $not: T } | { $not: Notted<T> };

export type MatchersForType<T extends unknown> =
  | T
  | RawMatchersForType<T>
  | Notted<RawMatchersForType<T>>
  | (T extends (infer U)[] ? U : T)
  | (T extends string ? RegExp : never);

export type RawMatchQuery<Schema extends Document> = {
  [selector in FieldSelector<Schema>]?: MatchersForType<
    InferFieldSelector<Schema, selector>
  >;
} & {
  $expr?: unknown;
};

export type MatchQuery<Schema extends Document> =
  | {
      $and?: MatchQuery<Schema>[];
      $or?: MatchQuery<Schema>[];
      $nor?: MatchQuery<Schema>[];
    }
  | RawMatchQuery<Schema>;

// Type narrowing utilities for match queries

// Extract literal values from match operators
export type ExpectedValue<Schema, QueryKey extends string, QueryValue> =
  QueryValue extends (
    {
      $eq: infer E;
    }
  ) ?
    E
  : QueryValue extends { $exists: true } ? GetFieldType<Schema, QueryKey>
  : QueryValue extends { $exists: false } ? unknown
  : QueryValue extends { [matcher in ContinuousMatchers]: unknown } ?
    GetFieldType<Schema, QueryKey>
  : QueryValue extends { $in: (infer I)[] } ? I
  : QueryValue extends { $all: (infer A)[] } ?
    A // For $all, return the array element type
  : QueryValue extends { $nin: (infer E)[] } ?
    Exclude<GetFieldType<Schema, QueryKey>, E>
  : QueryValue extends {
    [matcher in DollarPrefixed<string>]: unknown;
  } ?
    GetFieldType<Schema, QueryKey> // Do not narrow unknown selectors
  : QueryValue; // Direct literal value

// Simplified union member matching - checks if all query fields match the document
// We check each key in the query and ensure it matches in the document

export type FieldMatchingInterim<Doc extends Document, Query> = {
  [K in keyof Query]: K extends FieldSelector<Doc> ?
    ExpectedValue<Doc, K, Query[K]> extends GetFieldType<Doc, K> ?
      true
    : false
  : K extends `$${string}` ? true
  : Query[K] extends { $exists: false } ? true
  : false; // If key doesn't exist in Doc, skip it (not a field selector)
};

export type DocumentMatchesQuery<Doc extends Document, Query> =
  FieldMatchingInterim<Doc, Query>[keyof Query] extends true ? true : false;

// Filter union types to keep only members that match the query
export type FilterUnion<Union extends Document, Query> =
  Union extends Document ?
    DocumentMatchesQuery<Union, Query> extends true ?
      Union
    : never
  : never;

// Extract only the query fields, removing MatchQuery intersection properties
export type ExtractQueryFields<Q> = Omit<
  Q,
  | keyof MatchQuery<never> // Remove MatchQuery-specific properties
  | "$and"
  | "$or"
  | "$nor"
  | "$expr" // Remove logical operators
>;

// Main type resolution with proper narrowing
// Takes the schema explicitly since inference from MatchQuery is unreliable
export type ResolveMatchOutput<Query, Schema extends Document> =
  Query extends RawMatchQuery<Schema> ? FilterUnion<Schema, Query>
  : /* Complex operators ($and/$or/$nor) - keep original */ Schema;
