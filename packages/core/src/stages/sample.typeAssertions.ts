import { Assert, Equal } from "../utils/tests";
import { ResolveSampleOutput, SampleQuery } from "./sample";

// ============================================================================
// $sample Query Shape
// ============================================================================

// Test 1: Query requires a numeric `size` field
type SampleQueryTest = Assert<Equal<SampleQuery, { size: number }>>;

// ============================================================================
// $sample Output Type
// ============================================================================

// Test 2: Output equals input for a simple schema
type SimpleSchema = {
  name: string;
  age: number;
};

type SimpleSampleOutput = ResolveSampleOutput<SimpleSchema>;
type SimpleSampleTest = Assert<Equal<SimpleSampleOutput, SimpleSchema>>;

// Test 3: Nested schema is preserved
type NestedSchema = {
  config: { active: boolean };
};

type NestedSampleOutput = ResolveSampleOutput<NestedSchema>;
type NestedSampleTest = Assert<Equal<NestedSampleOutput, NestedSchema>>;

// Test 4: Union schemas pass through unchanged
type UnionSchema =
  | { type: "user"; name: string }
  | { type: "admin"; permissions: string[] };

type UnionSampleOutput = ResolveSampleOutput<UnionSchema>;
type UnionSampleTest = Assert<Equal<UnionSampleOutput, UnionSchema>>;

export type {
  SampleQueryTest,
  SimpleSampleTest,
  NestedSampleTest,
  UnionSampleTest,
};
