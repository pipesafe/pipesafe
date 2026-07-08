import { Assert, Equal } from "../utils/tests";
import { SortQuery, ResolveSortOutput } from "./sort";

// ============================================================================
// Basic Sort Queries
// ============================================================================

// Test 1: Simple field sort
type SimpleSchema = {
  name: string;
  age: number;
  createdAt: Date;
};

// Verify sort query accepts valid fields
type SimpleSortQuery = SortQuery<SimpleSchema>;
type SimpleSortTest = Assert<
  Equal<
    {
      name?: 1 | -1 | { $meta: "textScore" | "indexKey" };
      age?: 1 | -1 | { $meta: "textScore" | "indexKey" };
    },
    Pick<SimpleSortQuery, "name" | "age">
  >
>;

// Test 2: Output is unchanged
type SortOutput = ResolveSortOutput<SimpleSchema>;
type SortOutputTest = Assert<Equal<SortOutput, SimpleSchema>>;

// ============================================================================
// Nested Field Sorting
// ============================================================================

// Test 3: Nested fields
type NestedSchema = {
  user: {
    profile: {
      firstName: string;
      lastName: string;
    };
    age: number;
  };
  createdAt: Date;
};

type NestedSortQuery = SortQuery<NestedSchema>;
// Should accept nested field selectors
type NestedSortTest = Assert<
  Equal<
    { "user.profile.firstName"?: 1 | -1 | { $meta: "textScore" | "indexKey" } },
    Pick<NestedSortQuery, "user.profile.firstName">
  >
>;

// ============================================================================
// Array Field Sorting
// ============================================================================

// Test 4: Array fields (sorts by first element or specified criteria)
type ArraySchema = {
  tags: string[];
  scores: number[];
};

type ArraySortQuery = SortQuery<ArraySchema>;
type ArraySortTest = Assert<
  Equal<
    { tags?: 1 | -1 | { $meta: "textScore" | "indexKey" } },
    Pick<ArraySortQuery, "tags">
  >
>;

// ============================================================================
// Union Type Handling
// ============================================================================

// Test 5: Union types preserve through sort
type UnionSchema =
  | { type: "user"; name: string; email: string }
  | { type: "admin"; name: string; permissions: string[] };

type UnionSortOutput = ResolveSortOutput<UnionSchema>;
type UnionSortTest = Assert<Equal<UnionSortOutput, UnionSchema>>;

// ============================================================================
// Phase F — Strict field selector
// ============================================================================
// `SortQuery<Schema>` is strictly typed: arbitrary string keys (typos
// like `pipeline.sort({ naem: 1 })` against a schema with `name`) are
// rejected at compile time — no permissive `[key: string]` index
// signature.

type StrictSortSchema = { name: string; age: number };

// keyof SortQuery must equal exactly the schema's FieldSelector keys —
// no `string` index signature any more.
type _SortKeys = keyof SortQuery<StrictSortSchema>;
type _Assert_SortKeysAreFieldSelectors = Assert<
  Equal<_SortKeys, "name" | "age">
>;

// A typo is structurally not assignable to the strict shape.
type _Assert_TypoNotAssignable = Assert<
  Equal<{ naem: 1 } extends SortQuery<StrictSortSchema> ? true : false, false>
>;

// Positive: a valid sort still works.
type _Assert_ValidSort = Assert<
  Equal<{ name: 1 } extends SortQuery<StrictSortSchema> ? true : false, true>
>;

// Export test types to prevent unused variable errors
export type {
  SimpleSortTest,
  SortOutputTest,
  NestedSortTest,
  ArraySortTest,
  UnionSortTest,
  _Assert_SortKeysAreFieldSelectors,
  _Assert_TypoNotAssignable,
  _Assert_ValidSort,
};
