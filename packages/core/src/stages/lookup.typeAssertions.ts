import { Assert, Equal } from "../utils/tests";
import { ResolveLookupOutput } from "./lookup";
import type {
  Pipeline,
  PipelineBuilder,
  LookupAllowedStages,
} from "../pipeline/Pipeline";

/**
 * Type Resolution Behaviors for $lookup Stage:
 *
 * FEATURES:
 * 1. ARRAY FIELD ADDITION:
 *    The $lookup stage adds a new array field containing the joined documents.
 *    The field is always typed as an array of the pipeline output documents.
 *    Example: Adding "orders" field produces { ...originalFields, orders: Order[] }
 *
 * 2. FIELD REPLACEMENT:
 *    If the NewKey already exists in the schema, it is replaced with the lookup results.
 *    Uses Omit to remove the original field before adding the new array field.
 *    Example: Existing field "data" is replaced with joined results
 *
 * 3. PIPELINE OUTPUT INFERENCE:
 *    The type of elements in the array is inferred from the pipeline output.
 *    Supports complex pipeline transformations in the lookup.
 *    Example: Pipeline that projects specific fields results in projected type
 *
 * 4. UNION TYPE PRESERVATION:
 *    When starting docs are a union type, the lookup result is applied to
 *    each union member independently.
 *    Example: (Speaker | Attendee) with lookup becomes
 *             (Speaker & { orders: Order[] }) | (Attendee & { orders: Order[] })
 *
 * These tests use Assert<Equal> which checks structural compatibility.
 * All tests should pass correctly with proper type inference.
 */

// ============================================================================
// Basic Lookup - Adding New Field
// ============================================================================

// Test 1: Simple lookup adding a new field
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

type SimpleLookupResult = ResolveLookupOutput<
  UserSchema,
  "orders",
  OrderSchema
>;

type SimpleLookupExpected = {
  _id: string;
  name: string;
  email: string;
  orders: OrderSchema[];
};

type SimpleLookupTest = Assert<Equal<SimpleLookupResult, SimpleLookupExpected>>;

// Test 2: Lookup with different field name
type LookupPurchasesResult = ResolveLookupOutput<
  UserSchema,
  "purchases",
  OrderSchema
>;

type LookupPurchasesExpected = {
  _id: string;
  name: string;
  email: string;
  purchases: OrderSchema[];
};

type LookupPurchasesTest = Assert<
  Equal<LookupPurchasesResult, LookupPurchasesExpected>
>;

// ============================================================================
// Field Replacement
// ============================================================================

// Test 3: Replacing an existing field
type SchemaWithExistingField = {
  _id: string;
  name: string;
  orders: string; // This will be replaced
};

type ReplacementResult = ResolveLookupOutput<
  SchemaWithExistingField,
  "orders",
  OrderSchema
>;

type ReplacementExpected = {
  _id: string;
  name: string;
  orders: OrderSchema[];
};

type ReplacementTest = Assert<Equal<ReplacementResult, ReplacementExpected>>;

// Test 4: Replacing a field with different type
type SchemaWithNumberField = {
  userId: string;
  data: number;
};

type ReplaceNumberResult = ResolveLookupOutput<
  SchemaWithNumberField,
  "data",
  OrderSchema
>;

type ReplaceNumberExpected = {
  userId: string;
  data: OrderSchema[];
};

type ReplaceNumberTest = Assert<
  Equal<ReplaceNumberResult, ReplaceNumberExpected>
>;

// ============================================================================
// Complex Pipeline Outputs
// ============================================================================

// Test 5: Lookup with projected pipeline output
type ProjectedOrderSchema = {
  total: number;
  itemCount: number;
};

type ProjectedLookupResult = ResolveLookupOutput<
  UserSchema,
  "orderSummaries",
  ProjectedOrderSchema
>;

type ProjectedLookupExpected = {
  _id: string;
  name: string;
  email: string;
  orderSummaries: ProjectedOrderSchema[];
};

type ProjectedLookupTest = Assert<
  Equal<ProjectedLookupResult, ProjectedLookupExpected>
>;

// Test 6: Lookup with grouped pipeline output
type GroupedPipelineOutput = {
  _id: string;
  totalRevenue: number;
  orderCount: number;
};

type GroupedLookupResult = ResolveLookupOutput<
  UserSchema,
  "stats",
  GroupedPipelineOutput
>;

type GroupedLookupExpected = {
  _id: string;
  name: string;
  email: string;
  stats: GroupedPipelineOutput[];
};

type GroupedLookupTest = Assert<
  Equal<GroupedLookupResult, GroupedLookupExpected>
>;

// ============================================================================
// Nested Lookups
// ============================================================================

// Test 7: Document with existing lookup result getting another lookup
type UserWithOrders = {
  _id: string;
  name: string;
  orders: OrderSchema[];
};

type ProductSchema = {
  _id: string;
  name: string;
  price: number;
};

type NestedLookupResult = ResolveLookupOutput<
  UserWithOrders,
  "products",
  ProductSchema
>;

type NestedLookupExpected = {
  _id: string;
  name: string;
  orders: OrderSchema[];
  products: ProductSchema[];
};

type NestedLookupTest = Assert<Equal<NestedLookupResult, NestedLookupExpected>>;

// ============================================================================
// Union Types
// ============================================================================

// Test 8: Lookup on union type schema
type Person =
  | {
      type: "employee";
      employeeId: string;
      department: string;
    }
  | {
      type: "contractor";
      contractId: string;
      agency: string;
    };

type TaskSchema = {
  _id: string;
  title: string;
  assigneeId: string;
};

type UnionLookupResult = ResolveLookupOutput<Person, "tasks", TaskSchema>;

type UnionLookupExpected =
  | {
      type: "employee";
      employeeId: string;
      department: string;
      tasks: TaskSchema[];
    }
  | {
      type: "contractor";
      contractId: string;
      agency: string;
      tasks: TaskSchema[];
    };

type UnionLookupTest = Assert<Equal<UnionLookupResult, UnionLookupExpected>>;

// Test 9: Union type with field replacement
type PersonWithData =
  | {
      type: "employee";
      employeeId: string;
      data: string;
    }
  | {
      type: "contractor";
      contractId: string;
      data: number;
    };

type UnionReplacementResult = ResolveLookupOutput<
  PersonWithData,
  "data",
  TaskSchema
>;

type UnionReplacementExpected =
  | {
      type: "employee";
      employeeId: string;
      data: TaskSchema[];
    }
  | {
      type: "contractor";
      contractId: string;
      data: TaskSchema[];
    };

type UnionReplacementTest = Assert<
  Equal<UnionReplacementResult, UnionReplacementExpected>
>;

// ============================================================================
// Edge Cases
// ============================================================================

// Test 10: Empty pipeline output (unlikely but possible)
type EmptySchema = Record<string, never>;

type EmptyLookupResult = ResolveLookupOutput<UserSchema, "empty", EmptySchema>;

type EmptyLookupExpected = {
  _id: string;
  name: string;
  email: string;
  empty: EmptySchema[];
};

type EmptyLookupTest = Assert<Equal<EmptyLookupResult, EmptyLookupExpected>>;

// Test 11: Lookup adding field to minimal schema
type MinimalSchema = {
  id: string;
};

type MinimalLookupResult = ResolveLookupOutput<
  MinimalSchema,
  "related",
  OrderSchema
>;

type MinimalLookupExpected = {
  id: string;
  related: OrderSchema[];
};

type MinimalLookupTest = Assert<
  Equal<MinimalLookupResult, MinimalLookupExpected>
>;

// Test 12: Complex nested objects in lookup result
type ComplexJoinedSchema = {
  metadata: {
    created: Date;
    updated: Date;
  };
  nested: {
    deep: {
      value: number;
    };
  };
};

type ComplexLookupResult = ResolveLookupOutput<
  UserSchema,
  "complexData",
  ComplexJoinedSchema
>;

type ComplexLookupExpected = {
  _id: string;
  name: string;
  email: string;
  complexData: ComplexJoinedSchema[];
};

type ComplexLookupTest = Assert<
  Equal<ComplexLookupResult, ComplexLookupExpected>
>;

// Test 13: Self-referential lookup (e.g., manager-employee relationship)
type EmployeeSchema = {
  _id: string;
  name: string;
  managerId: string;
};

type SelfLookupResult = ResolveLookupOutput<
  EmployeeSchema,
  "manager",
  EmployeeSchema
>;

type SelfLookupExpected = {
  _id: string;
  name: string;
  managerId: string;
  manager: EmployeeSchema[];
};

type SelfLookupTest = Assert<Equal<SelfLookupResult, SelfLookupExpected>>;

// Test 14: Multiple sequential lookups
type FirstLookup = ResolveLookupOutput<UserSchema, "orders", OrderSchema>;
type SecondLookup = ResolveLookupOutput<FirstLookup, "products", ProductSchema>;

type SequentialLookupExpected = {
  _id: string;
  name: string;
  email: string;
  orders: OrderSchema[];
  products: ProductSchema[];
};

type SequentialLookupTest = Assert<
  Equal<SecondLookup, SequentialLookupExpected>
>;

// ============================================================================
// Sub-pipeline stage restrictions (via UsedStages tracking)
// ============================================================================

// Test 15: $out in sub-pipeline makes it incompatible with LookupAllowedStages
// A builder that uses $out cannot be assigned to a LookupAllowedStages builder
const _lookupSubOut: PipelineBuilder<
  UserSchema,
  never,
  "runtime",
  LookupAllowedStages
  // @ts-expect-error - "$out" not in LookupAllowedStages
> = (p) => p.out("test");

// Test 16: $facet IS allowed inside $lookup sub-pipeline
const _lookupSubFacet: PipelineBuilder<
  UserSchema,
  {
    summary: { _id: null; total: number }[];
    recent: UserSchema[];
  },
  "runtime",
  LookupAllowedStages
> = (p) =>
  p.facet({
    summary: (q) => q.group({ _id: null, total: { $count: {} } }),
    recent: (q) => q.sort({ _id: -1 }).limit(5),
  });

// Test 17: Standalone builder reuse — works in lookup context
const _standaloneBuilder = (
  p: Pipeline<UserSchema, UserSchema, "runtime", never>
) => p.match({ name: "test" });

const _reuseInLookup: PipelineBuilder<
  UserSchema,
  UserSchema,
  "runtime",
  LookupAllowedStages
> = _standaloneBuilder;

// Satisfy linting for runtime values
void _lookupSubOut;
void _lookupSubFacet;
void _standaloneBuilder;
void _reuseInLookup;

// Satisfy linting by exporting all test types
export type {
  SimpleLookupTest,
  LookupPurchasesTest,
  ReplacementTest,
  ReplaceNumberTest,
  ProjectedLookupTest,
  GroupedLookupTest,
  NestedLookupTest,
  UnionLookupTest,
  UnionReplacementTest,
  EmptyLookupTest,
  MinimalLookupTest,
  ComplexLookupTest,
  SelfLookupTest,
  SequentialLookupTest,
};

// ============================================================================
// Call-site $lookup field-type combinations
// ============================================================================
// MongoDB's $lookup matches localField against foreignField with element-wise
// semantics for arrays. The four type combinations (T=T, T[]=T, T=T[], T[]=T[])
// must all be accepted. The fix landed in Pipeline.lookup's ForeignField
// constraint by adding two extra arms: one that strips `(infer E)[]` from the
// localField type, and one that wraps the localField type in `[]`.
//
// These tests exercise actual `pipeline.lookup({...})` calls. If any of the
// `_callsite_*` constants fails to type-check the constraint has regressed.

import { Pipeline as _Pipeline } from "../pipeline/Pipeline";
import { Collection as _Collection } from "../collection/Collection";

// --- Local + Foreign schemas covering scalar, primitive arrays, complex
// arrays, and arrays reached via a dotted path ------------------------------

type LocalDoc = {
  _id: string;
  scalarRef: string;
  arrayRefs: string[];
  // Tests dotted-path inference: GetFieldType<LocalDoc, "wrapper.refs"> = string[]
  wrapper: { refs: string }[];
  numericRef: number;
  numericArrayRefs: number[];
  // Complex object array — element type is { id; tag } not a primitive
  payloads: { id: string; tag: string }[];
};

type ScalarForeignDoc = {
  _id: string;
  someNumericId: number;
  payloadId: { id: string; tag: string };
};

type ArrayForeignDoc = {
  _id: string;
  ids: string[];
  numericIds: number[];
  payloadIds: { id: string; tag: string }[];
};

declare const _scalarForeignCollection: _Collection<ScalarForeignDoc>;
declare const _arrayForeignCollection: _Collection<ArrayForeignDoc>;
declare const _basePipeline: _Pipeline<LocalDoc, LocalDoc, "runtime", never>;

// Combination 1: scalar T → scalar T (already worked)
const _callsite_scalar_to_scalar = _basePipeline.lookup({
  from: _scalarForeignCollection,
  localField: "scalarRef",
  foreignField: "_id",
  as: "joined",
});

// Combination 2: array T[] → scalar T (the demo-conference case)
const _callsite_array_to_scalar = _basePipeline.lookup({
  from: _scalarForeignCollection,
  localField: "arrayRefs",
  foreignField: "_id",
  as: "joined",
});

// Combination 3: scalar T → array T[]
const _callsite_scalar_to_array = _basePipeline.lookup({
  from: _arrayForeignCollection,
  localField: "scalarRef",
  foreignField: "ids",
  as: "joined",
});

// Combination 4: array T[] → array T[]
const _callsite_array_to_array = _basePipeline.lookup({
  from: _arrayForeignCollection,
  localField: "arrayRefs",
  foreignField: "ids",
  as: "joined",
});

// Numeric coverage to confirm the four arms aren't string-specific
const _callsite_numeric_array_to_scalar = _basePipeline.lookup({
  from: _scalarForeignCollection,
  localField: "numericArrayRefs",
  foreignField: "someNumericId",
  as: "joined",
});

// Complex-object array — element type is `{ id; tag }`, not a primitive.
// Verifies the `(infer Element)[]` arm strips the array wrapper for any E,
// not just primitives.
const _callsite_complex_array_to_scalar = _basePipeline.lookup({
  from: _scalarForeignCollection,
  localField: "payloads",
  foreignField: "payloadId",
  as: "joined",
});

const _callsite_complex_scalar_to_array = _basePipeline.lookup({
  from: _arrayForeignCollection,
  localField: "payloads",
  foreignField: "payloadIds",
  as: "joined",
});

// Dotted-path local field whose inferred type is `string[]` (`{ refs: string }[]`
// projected via a dotted path). The lookup helper's element-strip arm must
// handle dotted-path-derived array types the same way it handles direct
// array fields.
const _callsite_dotted_array_to_scalar = _basePipeline.lookup({
  from: _scalarForeignCollection,
  localField: "wrapper.refs",
  foreignField: "_id",
  as: "joined",
});

void _callsite_scalar_to_scalar;
void _callsite_array_to_scalar;
void _callsite_scalar_to_array;
void _callsite_array_to_array;
void _callsite_numeric_array_to_scalar;
void _callsite_complex_array_to_scalar;
void _callsite_complex_scalar_to_array;
void _callsite_dotted_array_to_scalar;
