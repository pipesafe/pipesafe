import { Assert, Equal } from "../utils/tests";
import { ResolveFacetOutput } from "./facet";
import type { PipelineBuilder, Pipeline } from "../pipeline/Pipeline";

/**
 * Type Resolution Behaviors for $facet Stage:
 *
 * FEATURES:
 * 1. MULTI-FACET OUTPUT:
 *    Each key in the facet maps to an array of its sub-pipeline's output type.
 *
 * 2. SINGLE FLAT OBJECT:
 *    Output is always a single document (not a union), with all facet keys.
 *
 * 3. DIFFERENT OUTPUT SHAPES:
 *    Each sub-pipeline can produce a completely different document shape.
 *
 * 4. UNION INPUT DOCUMENTS:
 *    Sub-pipelines can accept union-typed input documents.
 */

// ============================================================================
// Shared test schemas
// ============================================================================

type Product = {
  _id: string;
  name: string;
  category: string;
  price: number;
  soldCount: number;
};

// ============================================================================
// Test 1: Basic two-facet with different output shapes
// ============================================================================

type BasicFacet = {
  priceSummary: PipelineBuilder<Product, { _id: null; avgPrice: number }>;
  topItems: PipelineBuilder<Product, Product>;
};

type BasicResult = ResolveFacetOutput<Product, BasicFacet>;

type BasicExpected = {
  priceSummary: { _id: null; avgPrice: number }[];
  topItems: Product[];
};

type BasicTest = Assert<Equal<BasicResult, BasicExpected>>;

// ============================================================================
// Test 2: Facet with projected sub-pipeline
// ============================================================================

type ProjectedFacet = {
  names: PipelineBuilder<Product, { name: string; category: string }>;
};

type ProjectedResult = ResolveFacetOutput<Product, ProjectedFacet>;

type ProjectedExpected = {
  names: { name: string; category: string }[];
};

type ProjectedTest = Assert<Equal<ProjectedResult, ProjectedExpected>>;

// ============================================================================
// Test 3: Each key is always an array
// ============================================================================

type SingleFieldFacet = {
  counts: PipelineBuilder<Product, { _id: string; count: number }>;
};

type SingleFieldResult = ResolveFacetOutput<Product, SingleFieldFacet>;

// Verify the value is an array, not a single document
type ArrayCheckTest = Assert<
  Equal<SingleFieldResult["counts"], { _id: string; count: number }[]>
>;

// ============================================================================
// Test 4: Facet output is a single flat object (not union)
// ============================================================================

type ThreeFacet = {
  a: PipelineBuilder<Product, { x: number }>;
  b: PipelineBuilder<Product, { y: string }>;
  c: PipelineBuilder<Product, { z: boolean }>;
};

type ThreeResult = ResolveFacetOutput<Product, ThreeFacet>;

type ThreeExpected = {
  a: { x: number }[];
  b: { y: string }[];
  c: { z: boolean }[];
};

type ThreeTest = Assert<Equal<ThreeResult, ThreeExpected>>;

// ============================================================================
// Test 5: Sub-pipeline that chains multiple stages (output differs from input)
// ============================================================================

type ChainedFacet = {
  summary: PipelineBuilder<
    Product,
    { _id: string; totalRevenue: number; avgPrice: number }
  >;
  recent: PipelineBuilder<Product, { name: string; price: number }>;
};

type ChainedResult = ResolveFacetOutput<Product, ChainedFacet>;

type ChainedExpected = {
  summary: { _id: string; totalRevenue: number; avgPrice: number }[];
  recent: { name: string; price: number }[];
};

type ChainedTest = Assert<Equal<ChainedResult, ChainedExpected>>;

// ============================================================================
// Test 6: Union input documents
// ============================================================================

type OrderItem =
  | { type: "physical"; weight: number; name: string }
  | { type: "digital"; downloadUrl: string; name: string };

type UnionFacet = {
  all: PipelineBuilder<OrderItem, OrderItem>;
  counts: PipelineBuilder<OrderItem, { _id: string; count: number }>;
};

type UnionResult = ResolveFacetOutput<OrderItem, UnionFacet>;

type UnionExpected = {
  all: OrderItem[];
  counts: { _id: string; count: number }[];
};

type UnionTest = Assert<Equal<UnionResult, UnionExpected>>;

// ============================================================================
// Test 7: Sub-pipeline restrictions — $out and $facet disallowed
// ============================================================================

// @ts-expect-error - $out not allowed in sub-pipelines
const _subOut: PipelineBuilder<Product, never> = (p) => p.out("test");

const _subFacetHelper = (p: Pipeline<Product, Product, "runtime", "sub">) =>
  // @ts-expect-error - $facet not allowed in sub-pipelines
  p.facet({
    x: (q: Pipeline<Product, Product, "runtime", "sub">) => q.limit(1),
  });

// Satisfy linting by exporting all test types
export type {
  BasicTest,
  ProjectedTest,
  ArrayCheckTest,
  ThreeTest,
  ChainedTest,
  UnionTest,
};

// Satisfy linting for runtime values
void _subOut;
void _subFacetHelper;
