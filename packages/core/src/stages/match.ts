import { Document, IsPlainObject, Prettify } from "../utils/objects";
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
// Runtime operator-name lists — THE single source of every matcher key.
// The pattern, used throughout the package: declare a const array, infer
// its string union right next to it (`(typeof X)[number]`), and compose
// bigger lists/unions by spreading. Every ComparatorMatchers/Notted/
// RawMatchQuery key is mapped from one of these unions, so a name exists in
// exactly one place — sync is by construction; never re-introduce assertion
// pins for it. Exported so tooling (docs, the IDE autocomplete tests)
// consumes the same names.
// ---------------------------------------------------------------------------

export const EQUALITY_MATCHERS = ["$eq", "$ne"] as const;
type EqualityMatchers = (typeof EQUALITY_MATCHERS)[number];

/** $in and $nin work for all types. */
export const IN_MATCHERS = ["$in", "$nin"] as const;
type InMatchers = (typeof IN_MATCHERS)[number];

export const CONTINUOUS_MATCHERS = ["$gte", "$lte", "$gt", "$lt"] as const;
type ContinuousMatchers = (typeof CONTINUOUS_MATCHERS)[number];

// $exists and $type carry different operand types, so each needs its own
// singleton pair for the mapped keys in ComparatorMatchers; the exported
// group is their spread.
const EXISTS_MATCHERS = ["$exists"] as const;
type ExistsMatcher = (typeof EXISTS_MATCHERS)[number];

const TYPE_MATCHERS = ["$type"] as const;
type TypeMatcher = (typeof TYPE_MATCHERS)[number];

export const EXISTENCE_MATCHERS = [
  ...EXISTS_MATCHERS,
  ...TYPE_MATCHERS,
] as const;

export const SIZE_MATCHERS = ["$size"] as const;
type SizeMatcher = (typeof SIZE_MATCHERS)[number];

/** $all only makes sense for arrays. */
export const ARRAY_ONLY_MATCHERS = ["$all"] as const;
type ArrayOnlyMatcher = (typeof ARRAY_ONLY_MATCHERS)[number];

export const ELEMENT_MATCHERS = ["$elemMatch"] as const;
type ElementMatcher = (typeof ELEMENT_MATCHERS)[number];

export const REGEX_MATCHERS = ["$regex"] as const;
type RegexMatcher = (typeof REGEX_MATCHERS)[number];

export const NOT_MATCHERS = ["$not"] as const;
type NotMatcher = (typeof NOT_MATCHERS)[number];

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
/** The top-level logical operators — single source for MatchQuery and the
 * ResolveMatchOutput dispatch. */
export type LogicalMatchOperators = (typeof LOGICAL_MATCH_OPERATORS)[number];

const EXPR_MATCH_OPERATORS = ["$expr"] as const;
type ExprMatchOperator = (typeof EXPR_MATCH_OPERATORS)[number];

/** Every non-field top-level MatchQuery key: the logical operators + $expr. */
export const TOP_LEVEL_MATCH_OPERATORS = [
  ...LOGICAL_MATCH_OPERATORS,
  ...EXPR_MATCH_OPERATORS,
] as const;

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

// `$elemMatch`'s operand is a match query against the array's ELEMENT type,
// NOT the bare element. `ElemMatchFields` contributes the per-field map only
// when the element is a document (so `{ qty: { $gt: 5 } }` typechecks and its
// keys complete); scalar elements route through the comparator arms below.
// `U extends Document` (not just `IsPlainObject`) is what satisfies
// MatchFieldMap's constraint in the true branch.
type ElemMatchFields<U> =
  IsPlainObject<U> extends true ?
    U extends Document ?
      MatchFieldMap<U>
    : never
  : never;

// The `$elemMatch` operand: field-map (document elements) plus the
// element-level comparators (`{ $gte: 80 }`, `{ $not: … }`). A non-array
// field brands.
type ElemMatchQuery<T, Op extends string> =
  [T] extends [(infer U)[]] ?
    ElemMatchFields<U> | ComparatorMatchers<U> | Notted<ComparatorMatchers<U>>
  : PipeSafeError<RequiresMsg<"Operator", Op, "an array field">>;

type RegexOperand<T> = FieldOperand<
  T,
  string,
  RequiresMsg<"Operator", "$regex", "a string field">,
  RegExp | string
>;

export type ComparatorMatchers<T extends unknown> = Prettify<
  /* Always */ {
    [m in ExistsMatcher]?: boolean;
  } & {
    [m in TypeMatcher]?: SomeBSONType | SomeBSONType[];
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
    [m in ElementMatcher]?: ElemMatchQuery<T, m>;
  } & {
    [m in RegexMatcher]?: RegexOperand<T>;
  }
>;

// `ComparatorMatchers` restricted to the keys that make sense on a NON-array
// element — the operand set applied in the recursive element-passthrough arm
// of `RawMatchersForType`. Dropping the array-only keys ($size/$all/$elemMatch)
// stops their `PipeSafeError` operands (the element is not itself an array)
// from leaking a `~pipesafe.error` key into completion, while the shared
// comparators keep implicit element-operator matching intact. Built by
// composition over `ComparatorMatchers` — never re-spelling the operand
// constraints.
type ArrayOnlyMatcherKeys = SizeMatcher | ArrayOnlyMatcher | ElementMatcher;

export type ScalarMatchers<T> = Omit<
  ComparatorMatchers<T>,
  ArrayOnlyMatcherKeys
>;

// `[T] extends [(infer U)[]]` rather than naked `T extends ...` — the
// non-distributive form keeps a union-typed field intact when computing
// the brand's `Ctx`, so a typo against `status: 'pending' | 'shipped' |
// 'delivered'` hovers with the full union rather than just one branch.
export type RawMatchersForType<T extends unknown> =
  [T] extends [(infer U)[]] ?
    ComparatorMatchers<T> | ScalarMatchers<U> // Element matcher (passthrough)
  : ComparatorMatchers<T>;

export type Notted<T> =
  | { [m in NotMatcher]: T }
  | { [m in NotMatcher]: Notted<T> };

// A bare `RegExp` in the exact-value position leaks all its prototype members
// (exec, test, flags, source, …) into the key-completion list of every string
// field. Picking only the symbol-keyed `[Symbol.match]` member keeps RegExp
// INSTANCES assignable — `{ status: /^ship/ }` still typechecks — while
// contributing ZERO string keys to completion (the language service never
// lists symbol keys as members).
type RegExpShorthand = Pick<RegExp, typeof Symbol.match>;

// The exact-value (direct-equality) arm of a matcher. A plain object keeps its
// bare type so embedded-document key completions stay available. A NON-plain
// object type (Date, ObjectId, …) would leak its 40+ prototype members if kept
// bare; instead we keep only its symbol-keyed subset, which real instances
// still satisfy (they carry those symbols) yet contributes nothing to the key
// list. Objects with no symbol keys fall back to `object` intersected with the
// comparators (still an object, still no leaked keys). Scalars keep bare `T`.
type ExactValue<T> =
  IsPlainObject<T> extends true ? T
  : [T] extends [object] ?
    [Extract<keyof T, symbol>] extends [never] ?
      object & ComparatorMatchers<T>
    : Pick<T, Extract<keyof T, symbol>>
  : T;

export type MatchersForType<T extends unknown> =
  | ExactValue<T>
  | RawMatchersForType<T>
  | Notted<RawMatchersForType<T>>
  | (T extends (infer U)[] ? ExactValue<U> : never)
  | (T extends string ? RegExpShorthand : never);

// The field→matcher map at the heart of a raw match query. Factored out so
// `$elemMatch`'s document-element operand can reuse it verbatim without
// re-spelling the mapped type.
type MatchFieldMap<Schema extends Document> = {
  [selector in FieldSelector<Schema>]?: MatchersForType<
    InferFieldSelector<Schema, selector>
  >;
};

export type RawMatchQuery<Schema extends Document> = MatchFieldMap<Schema> & {
  [m in ExprMatchOperator]?: unknown;
};

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
