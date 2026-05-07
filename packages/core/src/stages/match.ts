import {
  Document,
  DollarPrefixed,
  PassThrough,
  PipeSafeError,
  Prettify,
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

// ---------------------------------------------------------------------------
// Operand helpers — return the valid operand type for a compatible field type,
// or a `PipeSafeError` whose literal message names the operator and the
// incompatible type the user wrote against.
// ---------------------------------------------------------------------------

type NumericOperand<T, Op extends string> =
  T extends number | Date ? T
  : PipeSafeError<
      `Operator '${Op}' is not allowed on this field (numeric/date only)`,
      T
    >;

type SizeOperand<T> =
  T extends unknown[] ? number
  : PipeSafeError<`Operator '$size' requires an array field`, T>;

type ArrayValueOperand<T, Op extends string> =
  T extends (infer U)[] ? U[]
  : PipeSafeError<`Operator '${Op}' requires an array field`, T>;

type ArrayElementOperand<T, Op extends string> =
  T extends (infer U)[] ? U
  : PipeSafeError<`Operator '${Op}' requires an array field`, T>;

type RegexOperand<T> =
  T extends string ? RegExp | string
  : PipeSafeError<`Operator '$regex' is only valid on string fields`, T>;

export type ComparatorMatchers<T extends unknown> = Prettify<
  /* Always */ {
    $exists?: boolean;
    $type?: SomeBSONType | SomeBSONType[];
  } & {
    [m in EqualityMatchers]?: T;
  } & {
    [m in InMatchers]?: T[];
  } & {
    [m in ContinuousMatchers]?: NumericOperand<T, m>;
  } & {
    $size?: SizeOperand<T>;
  } & {
    [m in ArrayOnlyMatcher]?: ArrayValueOperand<T, m>;
  } & {
    [m in ElementMatcher]?: ArrayElementOperand<T, m>;
  } & {
    $regex?: RegexOperand<T>;
  }
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

/**
 * Validation wrapper for $match queries used at Pipeline.match's
 * parameter position. Maps the user's literal M:
 *
 * - Logical operators (`$and`, `$or`, `$nor`) and `$expr` pass through.
 * - Known schema fields are typed as `MatchersForType<...>`, so the
 *   inner brand types (e.g. `$gte` against a string field) keep firing.
 * - Unknown top-level keys are replaced with a branded `PipeSafeError`,
 *   surfacing typos like `pipeline.match({ naem: { $eq: 'x' } })`.
 *
 * `<const M>` at the call site captures the literal so chained-stage
 * union narrowing via `ResolveMatchOutput<M, Schema>` is preserved.
 */
export type ValidateMatchQuery<Schema extends Document, M> = {
  [K in keyof M]: K extends `$${string}` ? M[K]
  : K extends FieldSelector<Schema> ?
    MatchersForType<InferFieldSelector<Schema, K>>
  : PipeSafeError<`Field '${K & string}' is not on the schema`, Schema>;
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
// PassThrough short-circuits when Schema is already a PipeSafeError (e.g. an
// earlier stage produced one). The match stage becomes a no-op so the user
// sees the original upstream error verbatim instead of a fresh constraint mismatch.
export type ResolveMatchOutput<Query, Schema extends Document> = PassThrough<
  Schema,
  Query extends RawMatchQuery<Schema> ? Prettify<FilterUnion<Schema, Query>>
  : /* Complex operators ($and/$or/$nor) - keep original */ Schema
>;
