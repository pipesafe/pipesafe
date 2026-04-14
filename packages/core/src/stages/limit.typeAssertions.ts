import { Assert, Equal } from "../utils/tests";
import { ResolveLimitOutput } from "./limit";

// ============================================================================
// $limit Output Type
// ============================================================================

// Test 1: Output equals input for a simple schema
type SimpleSchema = {
  name: string;
  age: number;
};

type SimpleLimitOutput = ResolveLimitOutput<SimpleSchema>;
type SimpleLimitTest = Assert<Equal<SimpleLimitOutput, SimpleSchema>>;

// Test 2: Nested schema is preserved
type NestedSchema = {
  user: {
    profile: {
      name: string;
    };
  };
  createdAt: Date;
};

type NestedLimitOutput = ResolveLimitOutput<NestedSchema>;
type NestedLimitTest = Assert<Equal<NestedLimitOutput, NestedSchema>>;

// Test 3: Union schemas pass through unchanged
type UnionSchema =
  | { kind: "a"; aValue: number }
  | { kind: "b"; bValue: string };

type UnionLimitOutput = ResolveLimitOutput<UnionSchema>;
type UnionLimitTest = Assert<Equal<UnionLimitOutput, UnionSchema>>;

export type { SimpleLimitTest, NestedLimitTest, UnionLimitTest };
