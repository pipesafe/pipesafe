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

// ---------------------------------------------------------------------------
// Runtime operator-name lists — THE source the matcher-key unions derive
// from (`(typeof X)[number]`), exported so tooling (docs, the IDE
// autocomplete tests) consumes the same names the types are built from.
// `FIELD_MATCH_OPERATORS` is pinned against `keyof ComparatorMatchers` in
// match.typeAssertions.ts so the spread combination cannot drift.
// ---------------------------------------------------------------------------

export const EQUALITY_MATCHERS = ["$eq", "$ne"] as const;
/** $in and $nin work for all types. */
export const IN_MATCHERS = ["$in", "$nin"] as const;
export const CONTINUOUS_MATCHERS = ["$gte", "$lte", "$gt", "$lt"] as const;
export const EXISTENCE_MATCHERS = ["$exists", "$type"] as const;
export const SIZE_MATCHERS = ["$size"] as const;
/** $all only makes sense for arrays. */
export const ARRAY_ONLY_MATCHERS = ["$all"] as const;
export const ELEMENT_MATCHERS = ["$elemMatch"] as const;
export const REGEX_MATCHERS = ["$regex"] as const;
export const NOT_MATCHERS = ["$not"] as const;

/** Every field-level matcher key ($not included via the Notted wrapper). */
export const FIELD_MATCH_OPERATORS = [
  ...EQUALITY_MATCHERS,
  ...IN_MATCHERS,
  ...CONTINUOUS_MATCHERS,
  ...EXISTENCE_MATCHERS,
  ...SIZE_MATCHERS,
  ...ARRAY_ONLY_MATCHERS,
  ...ELEMENT_MATCHERS,
  ...REGEX_MATCHERS,
  ...NOT_MATCHERS,
] as const;

export const LOGICAL_MATCH_OPERATORS = ["$and", "$or", "$nor"] as const;

/** Every non-field top-level MatchQuery key: the logical operators + $expr. */
export const TOP_LEVEL_MATCH_OPERATORS = [
  ...LOGICAL_MATCH_OPERATORS,
  "$expr",
] as const;

type ElementMatcher = (typeof ELEMENT_MATCHERS)[number];
type InMatchers = (typeof IN_MATCHERS)[number];
type ArrayOnlyMatcher = (typeof ARRAY_ONLY_MATCHERS)[number];
type EqualityMatchers = (typeof EQUALITY_MATCHERS)[number];
type ContinuousMatchers = (typeof CONTINUOUS_MATCHERS)[number];
type SizeMatcher = (typeof SIZE_MATCHERS)[number];
type RegexMatcher = (typeof REGEX_MATCHERS)[number];

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
    [m in SizeMatcher]?: SizeOperand<T>;
  } & {
    [m in ArrayOnlyMatcher]?: ArrayValueOperand<T, m>;
  } & {
    [m in ElementMatcher]?: ArrayElementOperand<T, m>;
  } & {
    [m in RegexMatcher]?: RegexOperand<T>;
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

/** The top-level logical operators — single source for MatchQuery and the
 * ResolveMatchOutput dispatch. */
export type LogicalMatchOperators = (typeof LOGICAL_MATCH_OPERATORS)[number];

export type MatchQuery<Schema extends Document> =
  | { [Op in LogicalMatchOperators]?: MatchQuery<Schema>[] }
  | RawMatchQuery<Schema>;

// Type narrowing utilities for match queries

// Extract literal values from match operators. GetFieldType is spelled
// per arm deliberately: conditional branches are lazy and repeats are
// alias-cached, so a hoisted cache parameter would buy nothing.
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

// Main type resolution with proper narrowing. PassThrough short-circuits
// when Schema is already a PipeSafeError so the user sees the original
// upstream error verbatim instead of a fresh constraint mismatch.
//
// The logical-vs-raw split is a cheap keyof check, not a structural
// `Query extends RawMatchQuery<Schema>` re-match — the method's generic
// constraint already validated Query at the parameter position.
export type ResolveMatchOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  [keyof Query & LogicalMatchOperators] extends [never] ?
    Prettify<FilterUnion<Schema, Query>>
  : /* Logical operators - keep original schema */ Schema
>;
