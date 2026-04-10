import { Assert, Equal } from "../utils/tests";
import { ResolveFacetOutput } from "./facet";
import type {
  PipelineBuilder,
  Pipeline,
  FacetAllowedStages,
} from "../pipeline/Pipeline";

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

type FacetBuilder<O> = PipelineBuilder<
  Product,
  O,
  "runtime",
  FacetAllowedStages
>;

// ============================================================================
// Test 1: Basic two-facet with different output shapes
// ============================================================================

type BasicFacet = {
  priceSummary: FacetBuilder<{ _id: null; avgPrice: number }>;
  topItems: FacetBuilder<Product>;
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
  names: FacetBuilder<{ name: string; category: string }>;
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
  counts: FacetBuilder<{ _id: string; count: number }>;
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
  a: FacetBuilder<{ x: number }>;
  b: FacetBuilder<{ y: string }>;
  c: FacetBuilder<{ z: boolean }>;
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
  summary: FacetBuilder<{
    _id: string;
    totalRevenue: number;
    avgPrice: number;
  }>;
  recent: FacetBuilder<{ name: string; price: number }>;
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
  all: PipelineBuilder<OrderItem, OrderItem, "runtime", FacetAllowedStages>;
  counts: PipelineBuilder<
    OrderItem,
    { _id: string; count: number },
    "runtime",
    FacetAllowedStages
  >;
};

type UnionResult = ResolveFacetOutput<OrderItem, UnionFacet>;

type UnionExpected = {
  all: OrderItem[];
  counts: { _id: string; count: number }[];
};

type UnionTest = Assert<Equal<UnionResult, UnionExpected>>;

// ============================================================================
// Test 7: $out blocked in facet sub-pipelines (used stages check)
// ============================================================================

// A builder that uses $out has UsedStages including "$out".
// "$out" is not in FacetAllowedStages, so assigning it errors.
// @ts-expect-error - $out not allowed in facet sub-pipelines
const _facetSubOut: FacetBuilder<never> = (p) => p.out("test");

// ============================================================================
// Test 8: $facet blocked inside $facet, allowed inside $lookup
// ============================================================================

// $facet inside $lookup sub-pipeline — allowed (facet IS in LookupAllowedStages)
const _lookupSubFacet = (p: Pipeline<Product, Product, "runtime", never>) =>
  p.facet({
    x: (q) => q.limit(1),
  });

// $facet inside $facet sub-pipeline — blocked ("$facet" not in FacetAllowedStages)
// @ts-expect-error - $facet not allowed in facet sub-pipelines
const _facetSubFacet: FacetBuilder<any> = (p) =>
  p.facet({
    x: (q: Pipeline<Product, Product, "runtime", never>) => q.limit(1),
  });

// ============================================================================
// Test 9: Standalone builder reuse across contexts
// ============================================================================

// A standalone builder that only uses $match — should work in any context
const _reusableBuilder = (p: Pipeline<Product, Product, "runtime", never>) =>
  p.match({ price: { $gte: 100 } });

// Works as a facet sub-pipeline (UsedStages = "$match" extends FacetAllowedStages)
const _reusableInFacet: FacetBuilder<{
  _id: string;
  name: string;
  category: string;
  price: number;
  soldCount: number;
}> = _reusableBuilder;

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
void _facetSubOut;
void _lookupSubFacet;
void _facetSubFacet;
void _reusableBuilder;
void _reusableInFacet;
