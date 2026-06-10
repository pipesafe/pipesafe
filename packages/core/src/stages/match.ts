import { Document, Prettify } from "../utils/objects";
import { DollarPrefixed } from "../utils/strings";
import { PassThrough, PipeSafeError, RequiresMsg } from "../utils/errors";
import { FieldOperand } from "../elements/operands";
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
// Operand helpers — one-liners over the FieldOperand kernel
// (elements/operands.ts): the valid operand type for a compatible field
// type, or a `PipeSafeError` built via RequiresMsg. Helpers that extract an
// inferred element type ($all, $elemMatch) keep a specialized conditional —
// still non-distributive via `[T] extends [...]` tuple wrapping.
// ---------------------------------------------------------------------------

type NumericOperand<T, Op extends string> = FieldOperand<
  T,
  number | Date,
  RequiresMsg<"Operator", Op, "a numeric or date field">
>;

type SizeOperand<T> = FieldOperand<
  T,
  unknown[],
  RequiresMsg<"Operator", "$size", "an array field">,
  number
>;

type ArrayValueOperand<T, Op extends string> =
  [T] extends [(infer U)[]] ? U[]
  : PipeSafeError<RequiresMsg<"Operator", Op, "an array field">>;

type ArrayElementOperand<T, Op extends string> =
  [T] extends [(infer U)[]] ? U
  : PipeSafeError<RequiresMsg<"Operator", Op, "an array field">>;

type RegexOperand<T> = FieldOperand<
  T,
  string,
  RequiresMsg<"Operator", "$regex", "a string field">,
  RegExp | string
>;

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

// `[T] extends [(infer U)[]]` rather than naked `T extends ...` — the
// non-distributive form keeps a union-typed field intact when computing
// the brand's `Ctx`, so a typo against `status: 'pending' | 'shipped' |
// 'delivered'` hovers with the full union rather than just one branch.
export type RawMatchersForType<T extends unknown> =
  [T] extends [(infer U)[]] ?
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

// Extract literal values from match operators.
// ATTEMPT-B VARIATION 2: no hoisted FieldType cache parameter — each arm
// spells GetFieldType lazily (only the taken branch instantiates it; repeat
// hits are alias-cached). Measures the spec's "defaults evaluate eagerly"
// caveat from the other direction vs attempt A's hoisted parameter.
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
//
// Operator-key dispatch (spec §3.4): the logical-vs-raw split is decided by a
// cheap keyof check instead of the full `Query extends RawMatchQuery<Schema>`
// structural re-match — the method's generic constraint already validated
// Query at the parameter position.
export type ResolveMatchOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  [keyof Query & ("$and" | "$or" | "$nor")] extends [never] ?
    Prettify<FilterUnion<Schema, Query>>
  : /* Logical operators - keep original schema */ Schema
>;
