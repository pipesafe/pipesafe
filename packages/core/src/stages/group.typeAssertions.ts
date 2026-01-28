import { Assert, Equal } from "../utils/tests";
import { ResolveGroupOutput } from "./group";

/**
 * Type Resolution Behaviors for $group Stage:
 *
 * FEATURES:
 * 1. _id FIELD INFERENCE:
 *    The _id field in the output is inferred from the grouping expression.
 *    Can be a literal, field reference, or complex expression.
 *    Example: { _id: "$category" } produces { _id: string }
 *
 * 2. AGGREGATOR FUNCTIONS:
 *    Each aggregator function resolves to its appropriate output type:
 *    - $sum: number
 *    - $avg: number
 *    - $count: number
 *    - $min: inferred from input type
 *    - $max: inferred from input type
 *    - $push: array of input type
 *    - $addToSet: array of input type
 *
 * 3. FIELD REFERENCE INFERENCE:
 *    Field references (prefixed with $) are resolved to their source types.
 *    Supports nested field paths like "$user.profile.age"
 *
 * 4. LITERAL VALUES:
 *    Literal values in aggregators are preserved.
 *    Example: { total: { $sum: 1 } } produces { total: number }
 *
 * 5. ARRAY ACCUMULATION:
 *    $push and $addToSet create arrays of the referenced field type.
 *    Example: { tags: { $push: "$tag" } } produces { tags: string[] }
 *
 * These tests use Assert<Equal> which checks structural compatibility.
 * All tests should pass correctly with proper type inference.
 */

// ============================================================================
// Basic Grouping with _id
// ============================================================================

// Test 1: Simple grouping by literal _id
type SimpleSchema = {
  category: string;
  price: number;
  name: string;
};

type SimpleLiteralGroup = {
  _id: null;
  total: { $sum: 1 };
};

type SimpleLiteralResult = ResolveGroupOutput<SimpleSchema, SimpleLiteralGroup>;

type SimpleLiteralExpected = {
  _id: null;
  total: number;
};

type SimpleLiteralTest = Assert<
  Equal<SimpleLiteralResult, SimpleLiteralExpected>
>;

// Test 2: Grouping by field reference
type FieldReferenceGroup = {
  _id: "$category";
  count: { $sum: 1 };
};

type FieldReferenceResult = ResolveGroupOutput<
  SimpleSchema,
  FieldReferenceGroup
>;

type FieldReferenceExpected = {
  _id: string;
  count: number;
};

type FieldReferenceTest = Assert<
  Equal<FieldReferenceResult, FieldReferenceExpected>
>;

// Test 3: Grouping by nested field reference
type NestedSchema = {
  user: {
    profile: {
      city: string;
      age: number;
    };
  };
  amount: number;
};

type NestedFieldGroup = {
  _id: "$user.profile.city";
  totalAmount: { $sum: "$amount" };
};

type NestedFieldResult = ResolveGroupOutput<NestedSchema, NestedFieldGroup>;

type NestedFieldExpected = {
  _id: string;
  totalAmount: number;
};

type NestedFieldTest = Assert<Equal<NestedFieldResult, NestedFieldExpected>>;

// ============================================================================
// $sum Aggregator
// ============================================================================

// Test 4: $sum with literal value
type SumLiteralGroup = {
  _id: "$category";
  itemCount: { $sum: 1 };
};

type SumLiteralResult = ResolveGroupOutput<SimpleSchema, SumLiteralGroup>;

type SumLiteralExpected = {
  _id: string;
  itemCount: number;
};

type SumLiteralTest = Assert<Equal<SumLiteralResult, SumLiteralExpected>>;

// Test 5: $sum with field reference
type SumFieldGroup = {
  _id: "$category";
  totalPrice: { $sum: "$price" };
};

type SumFieldResult = ResolveGroupOutput<SimpleSchema, SumFieldGroup>;

type SumFieldExpected = {
  _id: string;
  totalPrice: number;
};

type SumFieldTest = Assert<Equal<SumFieldResult, SumFieldExpected>>;

// ============================================================================
// $avg Aggregator
// ============================================================================

// Test 6: $avg with field reference
type AvgGroup = {
  _id: "$category";
  avgPrice: { $avg: "$price" };
};

type AvgResult = ResolveGroupOutput<SimpleSchema, AvgGroup>;

type AvgExpected = {
  _id: string;
  avgPrice: number;
};

type AvgTest = Assert<Equal<AvgResult, AvgExpected>>;

// ============================================================================
// $min and $max Aggregators
// ============================================================================

// Test 7: $min with number field
type MinNumberGroup = {
  _id: "$category";
  minPrice: { $min: "$price" };
};

type MinNumberResult = ResolveGroupOutput<SimpleSchema, MinNumberGroup>;

type MinNumberExpected = {
  _id: string;
  minPrice: number;
};

type MinNumberTest = Assert<Equal<MinNumberResult, MinNumberExpected>>;

// Test 8: $max with number field
type MaxNumberGroup = {
  _id: "$category";
  maxPrice: { $max: "$price" };
};

type MaxNumberResult = ResolveGroupOutput<SimpleSchema, MaxNumberGroup>;

type MaxNumberExpected = {
  _id: string;
  maxPrice: number;
};

type MaxNumberTest = Assert<Equal<MaxNumberResult, MaxNumberExpected>>;

// Test 9: $min with Date field
type DateSchema = {
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type MinDateGroup = {
  _id: "$status";
  earliestDate: { $min: "$createdAt" };
};

type MinDateResult = ResolveGroupOutput<DateSchema, MinDateGroup>;

type MinDateExpected = {
  _id: string;
  earliestDate: Date;
};

type MinDateTest = Assert<Equal<MinDateResult, MinDateExpected>>;

// ============================================================================
// $count Aggregator
// ============================================================================

// Test 10: $count aggregator
type CountGroup = {
  _id: "$category";
  total: { $count: {} };
};

type CountResult = ResolveGroupOutput<SimpleSchema, CountGroup>;

type CountExpected = {
  _id: string;
  total: number;
};

type CountTest = Assert<Equal<CountResult, CountExpected>>;

// ============================================================================
// $push Aggregator
// ============================================================================

// Test 11: $push with field reference
type PushGroup = {
  _id: "$category";
  names: { $push: "$name" };
};

type PushResult = ResolveGroupOutput<SimpleSchema, PushGroup>;

type PushExpected = {
  _id: string;
  names: string[];
};

type PushTest = Assert<Equal<PushResult, PushExpected>>;

// Test 12: $push with nested field reference
type PushNestedGroup = {
  _id: "$user.profile.city";
  ages: { $push: "$user.profile.age" };
};

type PushNestedResult = ResolveGroupOutput<NestedSchema, PushNestedGroup>;

type PushNestedExpected = {
  _id: string;
  ages: number[];
};

type PushNestedTest = Assert<Equal<PushNestedResult, PushNestedExpected>>;

// ============================================================================
// $addToSet Aggregator
// ============================================================================

// Test 13: $addToSet with field reference
type AddToSetGroup = {
  _id: "$category";
  uniqueNames: { $addToSet: "$name" };
};

type AddToSetResult = ResolveGroupOutput<SimpleSchema, AddToSetGroup>;

type AddToSetExpected = {
  _id: string;
  uniqueNames: string[];
};

type AddToSetTest = Assert<Equal<AddToSetResult, AddToSetExpected>>;

// Test 13b: $addToSet with nested field reference
type AddToSetNestedGroup = {
  _id: "$user.profile.city";
  uniqueAges: { $addToSet: "$user.profile.age" };
};

type AddToSetNestedResult = ResolveGroupOutput<
  NestedSchema,
  AddToSetNestedGroup
>;

type AddToSetNestedExpected = {
  _id: string;
  uniqueAges: number[];
};

type AddToSetNestedTest = Assert<
  Equal<AddToSetNestedResult, AddToSetNestedExpected>
>;

// Test 13c: $addToSet with number field
type AddToSetNumberGroup = {
  _id: "$category";
  uniquePrices: { $addToSet: "$price" };
};

type AddToSetNumberResult = ResolveGroupOutput<
  SimpleSchema,
  AddToSetNumberGroup
>;

type AddToSetNumberExpected = {
  _id: string;
  uniquePrices: number[];
};

type AddToSetNumberTest = Assert<
  Equal<AddToSetNumberResult, AddToSetNumberExpected>
>;

// Test 13d: $addToSet with optional field
type OptionalFieldSchema = {
  category: string;
  tag?: string;
  tags?: string[];
};

type AddToSetOptionalGroup = {
  _id: "$category";
  uniqueTags: { $addToSet: "$tag" };
};

type AddToSetOptionalResult = ResolveGroupOutput<
  OptionalFieldSchema,
  AddToSetOptionalGroup
>;

type AddToSetOptionalExpected = {
  _id: string;
  uniqueTags: (string | undefined)[];
};

type AddToSetOptionalTest = Assert<
  Equal<AddToSetOptionalResult, AddToSetOptionalExpected>
>;

// ============================================================================
// Multiple Aggregators
// ============================================================================

// Test 14: Multiple aggregator fields
type MultiAggregatorGroup = {
  _id: "$category";
  count: { $sum: 1 };
  avgPrice: { $avg: "$price" };
  minPrice: { $min: "$price" };
  maxPrice: { $max: "$price" };
  names: { $push: "$name" };
};

type MultiAggregatorResult = ResolveGroupOutput<
  SimpleSchema,
  MultiAggregatorGroup
>;

type MultiAggregatorExpected = {
  _id: string;
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  names: string[];
};

type MultiAggregatorTest = Assert<
  Equal<MultiAggregatorResult, MultiAggregatorExpected>
>;

// ============================================================================
// Complex _id Expressions
// ============================================================================

// Test 15: Literal object as _id
type ObjectIdGroup = {
  _id: {
    category: "$category";
    year: 2024;
  };
  total: { $sum: "$price" };
};

type ObjectIdResult = ResolveGroupOutput<SimpleSchema, ObjectIdGroup>;

type ObjectIdExpected = {
  _id: {
    category: string;
    year: 2024;
  };
  total: number;
};

type ObjectIdTest = Assert<Equal<ObjectIdResult, ObjectIdExpected>>;

// Test 16: Multiple field references in _id
type MultiFieldIdSchema = {
  year: number;
  month: number;
  category: string;
  sales: number;
};

type MultiFieldIdGroup = {
  _id: {
    year: "$year";
    month: "$month";
  };
  totalSales: { $sum: "$sales" };
};

type MultiFieldIdResult = ResolveGroupOutput<
  MultiFieldIdSchema,
  MultiFieldIdGroup
>;

type MultiFieldIdExpected = {
  _id: {
    year: number;
    month: number;
  };
  totalSales: number;
};

type MultiFieldIdTest = Assert<Equal<MultiFieldIdResult, MultiFieldIdExpected>>;

// ============================================================================
// Edge Cases
// ============================================================================

// Test 17: Grouping with only _id (no aggregators)
type OnlyIdGroup = {
  _id: "$category";
};

type OnlyIdResult = ResolveGroupOutput<SimpleSchema, OnlyIdGroup>;

type OnlyIdExpected = {
  _id: string;
};

type OnlyIdTest = Assert<Equal<OnlyIdResult, OnlyIdExpected>>;

// Test 18: Complex nested aggregation
type ComplexSchema = {
  order: {
    items: {
      product: string;
      quantity: number;
      price: number;
    }[];
    customer: {
      id: string;
      tier: string;
    };
  };
  timestamp: Date;
};

type ComplexGroup = {
  _id: "$order.customer.tier";
  totalOrders: { $sum: 1 };
  customerIds: { $addToSet: "$order.customer.id" };
  earliestOrder: { $min: "$timestamp" };
};

type ComplexResult = ResolveGroupOutput<ComplexSchema, ComplexGroup>;

type ComplexExpected = {
  _id: string;
  totalOrders: number;
  customerIds: string[];
  earliestOrder: Date;
};

type ComplexTest = Assert<Equal<ComplexResult, ComplexExpected>>;

// ============================================================================
// Test 19: Expression operators in _id field
// ============================================================================

// Test 19a: $dateToString in _id field
type DateToStringIdSchema = {
  timestamp: Date;
  eventType: string;
  userId: string;
};

type DateToStringIdGroup = {
  _id: {
    date: {
      $dateToString: {
        format: "%Y-%m-%d";
        date: "$timestamp";
      };
    };
    eventType: "$eventType";
  };
  count: { $count: {} };
};

type DateToStringIdResult = ResolveGroupOutput<
  DateToStringIdSchema,
  DateToStringIdGroup
>;

type DateToStringIdExpected = {
  _id: {
    date: string;
    eventType: string;
  };
  count: number;
};

type DateToStringIdTest = Assert<
  Equal<DateToStringIdResult, DateToStringIdExpected>
>;

// Test 19b: Arithmetic expressions in _id field
type ArithmeticIdSchema = {
  price: number;
  quantity: number;
  category: string;
};

type ArithmeticIdGroup = {
  _id: {
    totalValue: { $multiply: ["$price", "$quantity"] };
    category: "$category";
  };
  count: { $count: {} };
};

type ArithmeticIdResult = ResolveGroupOutput<
  ArithmeticIdSchema,
  ArithmeticIdGroup
>;

type ArithmeticIdExpected = {
  _id: {
    totalValue: number;
    category: string;
  };
  count: number;
};

type ArithmeticIdTest = Assert<Equal<ArithmeticIdResult, ArithmeticIdExpected>>;

// Test 19c: Nested expressions in _id field
type NestedExpressionIdSchema = {
  timestamp: Date;
  likes: number;
  comments: number;
  views: number;
};

type NestedExpressionIdGroup = {
  _id: {
    date: {
      $dateToString: {
        format: "%Y-%m-%d";
        date: "$timestamp";
      };
    };
    engagement: {
      $divide: [{ $add: ["$likes", "$comments"] }, "$views"];
    };
  };
  count: { $count: {} };
};

type NestedExpressionIdResult = ResolveGroupOutput<
  NestedExpressionIdSchema,
  NestedExpressionIdGroup
>;

type NestedExpressionIdExpected = {
  _id: {
    date: string;
    engagement: number;
  };
  count: number;
};

type NestedExpressionIdTest = Assert<
  Equal<NestedExpressionIdResult, NestedExpressionIdExpected>
>;

// ============================================================================
// Test 20: $first and $last aggregators
// ============================================================================
type FirstLastSchema = {
  author: {
    userId: string;
    name: string;
    avatar?: string;
  };
  title: string;
  publishedAt: Date;
};

type FirstLastGroup = {
  _id: "$author.userId";
  authorName: { $first: "$author.name" };
  authorAvatar: { $first: "$author.avatar" };
  firstTitle: { $first: "$title" };
  lastTitle: { $last: "$title" };
  firstPublishedAt: { $first: "$publishedAt" };
  lastPublishedAt: { $last: "$publishedAt" };
};

type FirstLastResult = ResolveGroupOutput<FirstLastSchema, FirstLastGroup>;

type FirstLastExpected = {
  _id: string;
  authorName: string;
  authorAvatar: string | undefined;
  firstTitle: string;
  lastTitle: string;
  firstPublishedAt: Date;
  lastPublishedAt: Date;
};

type FirstLastTest = Assert<Equal<FirstLastResult, FirstLastExpected>>;

// Satisfy linting by exporting all test types
export type {
  SimpleLiteralTest,
  FieldReferenceTest,
  NestedFieldTest,
  SumLiteralTest,
  SumFieldTest,
  AvgTest,
  MinNumberTest,
  MaxNumberTest,
  MinDateTest,
  CountTest,
  PushTest,
  PushNestedTest,
  AddToSetTest,
  AddToSetNestedTest,
  AddToSetNumberTest,
  AddToSetOptionalTest,
  MultiAggregatorTest,
  ObjectIdTest,
  MultiFieldIdTest,
  OnlyIdTest,
  ComplexTest,
  DateToStringIdTest,
  ArithmeticIdTest,
  NestedExpressionIdTest,
  FirstLastTest,
};
