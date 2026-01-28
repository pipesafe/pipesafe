import { Assert, Equal } from "../utils/tests";
import { ResolveUnionWithOutput } from "./unionWith";

/**
 * Type Resolution Behaviors for $unionWith Stage:
 *
 * FEATURES:
 * 1. UNION TYPE CREATION:
 *    The $unionWith stage creates a union type of the current documents
 *    and the unioned collection documents.
 *    Example: UserSchema | OrderSchema produces union of both types
 *
 * 2. PIPELINE OUTPUT INFERENCE:
 *    The type of unioned documents is inferred from the pipeline output.
 *    Supports complex pipeline transformations in the union.
 *    Example: Pipeline that projects specific fields results in projected type
 *
 * 3. OPTIONAL PIPELINE:
 *    If no pipeline is provided, uses the collection's document type directly.
 *    If pipeline is provided, uses the pipeline output type.
 *
 * These tests use Assert<Equal> which checks structural compatibility.
 * All tests should pass correctly with proper type inference.
 */

// ============================================================================
// Test 1: Basic union without pipeline
// ============================================================================
type UserSchema = {
  _id: string;
  name: string;
  email: string;
};

type OrderSchema = {
  _id: string;
  userId: string;
  total: number;
  items: string[];
};

type BasicUnionResult = ResolveUnionWithOutput<UserSchema, OrderSchema>;

type BasicUnionExpected = UserSchema | OrderSchema;

type BasicUnionTest = Assert<Equal<BasicUnionResult, BasicUnionExpected>>;

// ============================================================================
// Test 2: Union with different schemas
// ============================================================================
type ProductSchema = {
  _id: string;
  name: string;
  price: number;
  category: string;
};

type ReviewSchema = {
  _id: string;
  productId: string;
  rating: number;
  comment: string;
};

type DifferentSchemasResult = ResolveUnionWithOutput<
  ProductSchema,
  ReviewSchema
>;

type DifferentSchemasExpected = ProductSchema | ReviewSchema;

type DifferentSchemasTest = Assert<
  Equal<DifferentSchemasResult, DifferentSchemasExpected>
>;

// ============================================================================
// Test 3: Union with compatible schemas (same structure)
// ============================================================================
type SchemaA = {
  _id: string;
  value: number;
};

type SchemaB = {
  _id: string;
  value: number;
};

type CompatibleSchemasResult = ResolveUnionWithOutput<SchemaA, SchemaB>;

// When schemas are structurally identical, the union should collapse to a single type
type CompatibleSchemasExpected = SchemaA;

type CompatibleSchemasTest = Assert<
  Equal<CompatibleSchemasResult, CompatibleSchemasExpected>
>;

// ============================================================================
// Test 4: Union with nested objects
// ============================================================================
type NestedSchemaA = {
  _id: string;
  user: {
    name: string;
    age: number;
  };
};

type NestedSchemaB = {
  _id: string;
  metadata: {
    created: Date;
    updated: Date;
  };
};

type NestedSchemasResult = ResolveUnionWithOutput<NestedSchemaA, NestedSchemaB>;

type NestedSchemasExpected = NestedSchemaA | NestedSchemaB;

type NestedSchemasTest = Assert<
  Equal<NestedSchemasResult, NestedSchemasExpected>
>;

export type {
  BasicUnionTest,
  DifferentSchemasTest,
  CompatibleSchemasTest,
  NestedSchemasTest,
};
