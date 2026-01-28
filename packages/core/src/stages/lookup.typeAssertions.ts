import { Assert, Equal } from "../utils/tests";
import { ResolveLookupOutput } from "./lookup";

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
