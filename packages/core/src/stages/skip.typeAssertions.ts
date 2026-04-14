import { Assert, Equal } from "../utils/tests";
import { ResolveSkipOutput } from "./skip";

// ============================================================================
// $skip Output Type
// ============================================================================

// Test 1: Output equals input for a simple schema
type SimpleSchema = {
  name: string;
  age: number;
};

type SimpleSkipOutput = ResolveSkipOutput<SimpleSchema>;
type SimpleSkipTest = Assert<Equal<SimpleSkipOutput, SimpleSchema>>;

// Test 2: Nested schema is preserved
type NestedSchema = {
  meta: {
    tags: string[];
  };
};

type NestedSkipOutput = ResolveSkipOutput<NestedSchema>;
type NestedSkipTest = Assert<Equal<NestedSkipOutput, NestedSchema>>;

// Test 3: Union schemas pass through unchanged
type UnionSchema = { kind: "x"; value: number } | { kind: "y"; value: string };

type UnionSkipOutput = ResolveSkipOutput<UnionSchema>;
type UnionSkipTest = Assert<Equal<UnionSkipOutput, UnionSchema>>;

export type { SimpleSkipTest, NestedSkipTest, UnionSkipTest };
