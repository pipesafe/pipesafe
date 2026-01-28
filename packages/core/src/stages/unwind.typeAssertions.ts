import { Assert, Equal } from "../utils/tests";
import {
  ResolveUnwindOutput,
  ExtractUnwindPath,
  ExtractIndexField,
} from "./unwind";

// ============================================================================
// Basic Unwind
// ============================================================================

// Test 1: Simple array unwind - output type transformation
type SimpleSchema = {
  _id: string;
  tags: string[];
  count: number;
};

type SimpleUnwindOutput = ResolveUnwindOutput<SimpleSchema, "tags", never>;
type SimpleUnwindTest = Assert<
  Equal<SimpleUnwindOutput, { _id: string; tags: string; count: number }>
>;

// ============================================================================
// Object Array Unwind
// ============================================================================

// Test 2: Array of objects - flattens to object
type OrderSchema = {
  _id: string;
  userId: string;
  items: { productId: string; quantity: number; price: number }[];
  createdAt: Date;
};

type OrderUnwindOutput = ResolveUnwindOutput<OrderSchema, "items", never>;
type OrderUnwindTest = Assert<
  Equal<
    OrderUnwindOutput,
    {
      _id: string;
      userId: string;
      items: { productId: string; quantity: number; price: number };
      createdAt: Date;
    }
  >
>;

// ============================================================================
// With includeArrayIndex
// ============================================================================

// Test 3: Including array index
type WithIndexOutput = ResolveUnwindOutput<OrderSchema, "items", "itemIndex">;
type WithIndexTest = Assert<
  Equal<
    WithIndexOutput,
    {
      _id: string;
      userId: string;
      items: { productId: string; quantity: number; price: number };
      createdAt: Date;
      itemIndex: number;
    }
  >
>;

// ============================================================================
// Nested Array Handling
// ============================================================================

// Test 4: Nested arrays (unwind one level)
type MatrixSchema = {
  _id: string;
  matrix: number[][];
};

type MatrixUnwindOutput = ResolveUnwindOutput<MatrixSchema, "matrix", never>;
type MatrixUnwindTest = Assert<
  Equal<MatrixUnwindOutput, { _id: string; matrix: number[] }>
>;

// ============================================================================
// Multiple Array Fields
// ============================================================================

// Test 5: Schema with multiple arrays - only specified one is unwound
type MultiArraySchema = {
  _id: string;
  tags: string[];
  scores: number[];
  items: { name: string }[];
};

type UnwindTagsOutput = ResolveUnwindOutput<MultiArraySchema, "tags", never>;
type UnwindTagsTest = Assert<
  Equal<
    UnwindTagsOutput,
    {
      _id: string;
      tags: string;
      scores: number[];
      items: { name: string }[];
    }
  >
>;

type UnwindScoresOutput = ResolveUnwindOutput<
  MultiArraySchema,
  "scores",
  never
>;
type UnwindScoresTest = Assert<
  Equal<
    UnwindScoresOutput,
    {
      _id: string;
      tags: string[];
      scores: number;
      items: { name: string }[];
    }
  >
>;

// ============================================================================
// Path Extraction Helpers
// ============================================================================

// Test 6: Extract path from string
type ExtractedPath1 = ExtractUnwindPath<"$items">;
type ExtractPathStringTest = Assert<Equal<ExtractedPath1, "items">>;

// Test 7: Extract path from options object
type ExtractedPath2 = ExtractUnwindPath<{
  path: "$tags";
  preserveNullAndEmptyArrays: true;
}>;
type ExtractPathOptionsTest = Assert<Equal<ExtractedPath2, "tags">>;

// Test 8: Extract index field
type ExtractedIndex = ExtractIndexField<{
  path: "$items";
  includeArrayIndex: "idx";
}>;
type ExtractIndexTest = Assert<Equal<ExtractedIndex, "idx">>;

// Test 9: No index field when not specified
type NoIndex = ExtractIndexField<{ path: "$items" }>;
type NoIndexTest = Assert<Equal<NoIndex, never>>;

// ============================================================================
// Optional Array Fields
// ============================================================================

// Test 10: Optional array fields - output preserves optionality
type OptionalArraySchema = {
  _id: string;
  tags?: string[];
};

type OptionalUnwindOutput = ResolveUnwindOutput<
  OptionalArraySchema,
  "tags",
  never
>;
// When unwinding optional array, the field stays optional and element type is unwound
// tags?: string[] becomes tags?: string | undefined (optional field with unwound element)
type OptionalUnwindTest = Assert<
  Equal<OptionalUnwindOutput, { _id: string; tags?: string | undefined }>
>;

// Export test types to prevent unused variable errors
export type {
  SimpleUnwindTest,
  OrderUnwindTest,
  WithIndexTest,
  MatrixUnwindTest,
  UnwindTagsTest,
  UnwindScoresTest,
  ExtractPathStringTest,
  ExtractPathOptionsTest,
  ExtractIndexTest,
  NoIndexTest,
  OptionalUnwindTest,
};
