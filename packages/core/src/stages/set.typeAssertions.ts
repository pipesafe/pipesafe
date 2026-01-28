import { Assert, Equal } from "../utils/tests";
import { ResolveSetOutput } from "./set";

/**
 * Type Resolution Behaviors:
 *
 * FEATURES:
 * 1. LITERAL TYPE PRESERVATION (Intentional):
 *    Literal values in $set operations preserve their literal types for better
 *    type precision. This allows TypeScript to track exact values being set.
 *    Example: { a: "hello" } resolves to { a: "hello" } not { a: string }
 *
 * 2. OPTIONAL FIELD PRESERVATION (Fixed):
 *    When setting a subset of fields in a nested object, other optional fields
 *    are now properly preserved in the resulting type.
 *    Example: Setting { "a.b": "hello" } on { a?: { b: string; c: string } }
 *             correctly produces { a: { b: "hello"; c?: string } }
 *
 * 3. $$REMOVE SUPPORT:
 *    The special value "$$REMOVE" removes fields from documents. Fields set to
 *    $$REMOVE are excluded from the resulting type (typed as never).
 *    Example: { b: "$$REMOVE" } on { a: string; b: number } produces { a: string }
 *
 * These tests use Assert<Equal which checks structural compatibility rather than
 * exact type equality. All tests should pass correctly with proper type inference.
 */

// Test 1: Setting an optional field
// Feature: Literal type "hello" is intentionally preserved for type precision
type BasicOptionalFieldSchema = {
  a?: string | undefined;
};

type BasicOptionalFieldSet = {
  a: "hello";
};

type BasicOptionalFieldResult = ResolveSetOutput<
  BasicOptionalFieldSet,
  BasicOptionalFieldSchema
>;

type BasicOptionalFieldExpected = {
  a: "hello";
};

type BasicOptionalFieldTest = Assert<
  Equal<BasicOptionalFieldResult, BasicOptionalFieldExpected>
>;

// Test 2: Setting a nested optional field
type NestedOptionalSchema = {
  a?:
    | {
        b?: string | undefined;
      }
    | undefined;
};

type NestedOptionalSet = {
  "a.b": "hello";
};

type NestedOptionalResult = ResolveSetOutput<
  NestedOptionalSet,
  NestedOptionalSchema
>;

type NestedOptionalExpected = {
  a: {
    b: "hello";
  };
};

type NestedOptionalTest = Assert<
  Equal<NestedOptionalResult, NestedOptionalExpected>
>;

// Test 3a: Preserving existing fields when setting nested values
type NestedPreserveExistingSchema = {
  a?:
    | {
        b: string;
        c: string;
      }
    | undefined;
};

type NestedPreserveExistingSet = {
  "a.b": "hello";
};

type NestedPreserveExistingResult = ResolveSetOutput<
  NestedPreserveExistingSet,
  NestedPreserveExistingSchema
>;

type NestedPreserveExistingExpected = {
  a: {
    b: "hello";
    c?: string | undefined;
  };
};

type NestedPreserveExistingTest = Assert<
  Equal<NestedPreserveExistingResult, NestedPreserveExistingExpected>
>;

// Test 3b: Preserving existing fields when setting nested values
type NestedFullPreserveExistingSchema = {
  a: {
    b: string;
  };
};

type NestedFullPreserveExistingSet = {
  a: { c: "hello" };
};

type NestedFullPreserveExistingResult = ResolveSetOutput<
  NestedFullPreserveExistingSet,
  NestedFullPreserveExistingSchema
>;

type NestedFullPreserveExistingExpected = {
  a: {
    b: string;
    c: "hello";
  };
};

type NestedFullPreserveExistingTest = Assert<
  Equal<NestedFullPreserveExistingResult, NestedFullPreserveExistingExpected>
>;

// Test 4: Adding a new field not in the original schema
// Feature: Literal type 42 is preserved for type precision
type AddNewFieldSchema = {
  a: number;
};

type AddNewFieldSet = {
  b: 42;
};

type AddNewFieldResult = ResolveSetOutput<AddNewFieldSet, AddNewFieldSchema>;

type AddNewFieldExpected = {
  a: number;
  b: 42;
};

type AddNewFieldTest = Assert<Equal<AddNewFieldResult, AddNewFieldExpected>>;

// Test 4b: Using $arrayElemAt preserves optional properties in array elements
// When extracting an element from an array, the element's optional properties should be preserved
// This tests the fix in MergeSetValue that returns UpdateValue directly when BaseValue is never
type ArrayElemAtOptionalSchema = {
  _id: string;
  items: { name: string; quantity?: number; metadata?: { tags: string[] } }[];
};

type ArrayElemAtOptionalSet = {
  first_item: { $arrayElemAt: ["$items", 0] };
};

type ArrayElemAtOptionalResult = ResolveSetOutput<
  ArrayElemAtOptionalSet,
  ArrayElemAtOptionalSchema
>;

type ArrayElemAtOptionalExpected = {
  _id: string;
  items: { name: string; quantity?: number; metadata?: { tags: string[] } }[];
  first_item: {
    name: string;
    quantity?: number;
    metadata?: { tags: string[] };
  };
};

type ArrayElemAtOptionalTest = Assert<
  Equal<ArrayElemAtOptionalResult, ArrayElemAtOptionalExpected>
>;

// Test 4c: Verify nested optional properties are preserved through $arrayElemAt
// Ensures the fix works for deeply nested optional properties
type ArrayElemAtNestedOptionalSchema = {
  _id: string;
  orders: {
    orderId: string;
    customer?: {
      name: string;
      email?: string;
      preferences?: { theme?: string };
    };
  }[];
};

type ArrayElemAtNestedOptionalSet = {
  latest_order: { $arrayElemAt: ["$orders", -1] };
};

type ArrayElemAtNestedOptionalResult = ResolveSetOutput<
  ArrayElemAtNestedOptionalSet,
  ArrayElemAtNestedOptionalSchema
>;

type ArrayElemAtNestedOptionalExpected = {
  _id: string;
  orders: {
    orderId: string;
    customer?: {
      name: string;
      email?: string;
      preferences?: { theme?: string };
    };
  }[];
  latest_order: {
    orderId: string;
    customer?: {
      name: string;
      email?: string;
      preferences?: { theme?: string };
    };
  };
};

type ArrayElemAtNestedOptionalTest = Assert<
  Equal<ArrayElemAtNestedOptionalResult, ArrayElemAtNestedOptionalExpected>
>;

// Test 5: Using $concatArrays transformation expression
// Feature: Literal array element types are preserved
type ArrayConcatSchema = {
  nums: number[];
};

type ArrayConcatSet = {
  nums: {
    $concatArrays: [[1, 2], [3]];
  };
};

type ArrayConcatResult = ResolveSetOutput<ArrayConcatSet, ArrayConcatSchema>;

type ArrayConcatExpected = {
  nums: (1 | 2 | 3)[];
};

type ArrayConcatTest = Assert<Equal<ArrayConcatResult, ArrayConcatExpected>>;

// Test 5b: Using $size transformation expression
type SizeExpressionSchema = {
  items: string[];
  tags: string[];
  metadata: {
    categories: number[];
  };
};

type SizeExpressionSet = {
  itemCount: { $size: "$items" };
  tagCount: { $size: "$tags" };
};

type SizeExpressionResult = ResolveSetOutput<
  SizeExpressionSet,
  SizeExpressionSchema
>;

type SizeExpressionExpected = {
  items: string[];
  tags: string[];
  metadata: {
    categories: number[];
  };
  itemCount: number;
  tagCount: number;
};

type SizeExpressionTest = Assert<
  Equal<SizeExpressionResult, SizeExpressionExpected>
>;

// Test 5c: $size with array literal
type SizeLiteralSet = {
  fixedSize: { $size: [1, 2, 3, 4, 5] };
};

type SizeLiteralResult = ResolveSetOutput<SizeLiteralSet, SizeExpressionSchema>;

type SizeLiteralExpected = {
  items: string[];
  tags: string[];
  metadata: {
    categories: number[];
  };
  fixedSize: number;
};

type SizeLiteralTest = Assert<Equal<SizeLiteralResult, SizeLiteralExpected>>;

// Test 5d: $size with nested array field
type SizeNestedSet = {
  categoryCount: { $size: "$metadata.categories" };
};

type SizeNestedResult = ResolveSetOutput<SizeNestedSet, SizeExpressionSchema>;

type SizeNestedExpected = {
  items: string[];
  tags: string[];
  metadata: {
    categories: number[];
  };
  categoryCount: number;
};

type SizeNestedTest = Assert<Equal<SizeNestedResult, SizeNestedExpected>>;

// ============================================================================
// Test 6: Arithmetic expressions
// ============================================================================
type ArithmeticSchema = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
};

// Test 6a: $add expression
type AddSet = {
  totalEngagement: { $add: ["$totalLikes", "$totalComments"] };
};

type AddResult = ResolveSetOutput<AddSet, ArithmeticSchema>;

type AddExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  totalEngagement: number;
};

type AddTest = Assert<Equal<AddResult, AddExpected>>;

// Test 6b: $divide expression
type DivideSet = {
  engagementRate: { $divide: ["$totalLikes", "$totalViews"] };
};

type DivideResult = ResolveSetOutput<DivideSet, ArithmeticSchema>;

type DivideExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  engagementRate: number;
};

type DivideTest = Assert<Equal<DivideResult, DivideExpected>>;

// Test 6c: Nested arithmetic expressions ($add inside $divide)
type NestedArithmeticSet = {
  engagementRate: {
    $divide: [{ $add: ["$totalLikes", "$totalComments"] }, "$totalViews"];
  };
};

type NestedArithmeticResult = ResolveSetOutput<
  NestedArithmeticSet,
  ArithmeticSchema
>;

type NestedArithmeticExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  engagementRate: number;
};

type NestedArithmeticTest = Assert<
  Equal<NestedArithmeticResult, NestedArithmeticExpected>
>;

// Test 6d: $multiply expression
type MultiplySet = {
  totalPrice: { $multiply: ["$price", "$quantity"] };
};

type MultiplyResult = ResolveSetOutput<MultiplySet, ArithmeticSchema>;

type MultiplyExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  totalPrice: number;
};

type MultiplyTest = Assert<Equal<MultiplyResult, MultiplyExpected>>;

// Test 6e: $subtract expression
type SubtractSet = {
  finalPrice: { $subtract: ["$basePrice", "$discount"] };
};

type SubtractResult = ResolveSetOutput<SubtractSet, ArithmeticSchema>;

type SubtractExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  finalPrice: number;
};

type SubtractTest = Assert<Equal<SubtractResult, SubtractExpected>>;

// Test 6f: $mod expression
type ModSet = {
  remainder: { $mod: ["$totalViews", 7] };
};

type ModResult = ResolveSetOutput<ModSet, ArithmeticSchema>;

type ModExpected = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
  remainder: number;
};

type ModTest = Assert<Equal<ModResult, ModExpected>>;

// ============================================================================
// Test 7: String expressions
// ============================================================================
type StringSchema = {
  firstName: string;
  lastName: string;
  prefix: string;
  suffix: string;
};

// Test 7a: $concat expression
type ConcatSet = {
  fullName: { $concat: ["$firstName", " ", "$lastName"] };
};

type ConcatResult = ResolveSetOutput<ConcatSet, StringSchema>;

type ConcatExpected = {
  firstName: string;
  lastName: string;
  prefix: string;
  suffix: string;
  fullName: string;
};

export type ConcatTest = Assert<Equal<ConcatResult, ConcatExpected>>;

// ============================================================================
// Date Expression Tests ($dateTrunc, $dateAdd, $dateSubtract)
// ============================================================================

type DateSchema = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
};

// Test 7b: $dateTrunc expression - truncates date to specified unit
type DateTruncSet = {
  eventDate: { $dateTrunc: { date: "$createdAt"; unit: "day" } };
};

type DateTruncResult = ResolveSetOutput<DateTruncSet, DateSchema>;

type DateTruncExpected = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  eventDate: Date; // $dateTrunc returns Date
};

type DateTruncTest = Assert<Equal<DateTruncResult, DateTruncExpected>>;

// Test 7c: $dateTrunc with all options
type DateTruncFullSet = {
  weekStart: {
    $dateTrunc: {
      date: "$createdAt";
      unit: "week";
      binSize: 1;
      timezone: "America/New_York";
      startOfWeek: "monday";
    };
  };
};

type DateTruncFullResult = ResolveSetOutput<DateTruncFullSet, DateSchema>;

type DateTruncFullExpected = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  weekStart: Date;
};

type DateTruncFullTest = Assert<
  Equal<DateTruncFullResult, DateTruncFullExpected>
>;

// Test 7d: $dateAdd expression - adds time to a date
type DateAddSet = {
  expiresAt: { $dateAdd: { startDate: "$createdAt"; unit: "day"; amount: 30 } };
};

type DateAddResult = ResolveSetOutput<DateAddSet, DateSchema>;

type DateAddExpected = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  expiresAt: Date; // $dateAdd returns Date
};

type DateAddTest = Assert<Equal<DateAddResult, DateAddExpected>>;

// Test 7e: $dateAdd with field reference for amount
type DateAddDynamicSet = {
  futureDate: {
    $dateAdd: { startDate: "$createdAt"; unit: "hour"; amount: "$count" };
  };
};

type DateAddDynamicResult = ResolveSetOutput<DateAddDynamicSet, DateSchema>;

type DateAddDynamicExpected = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  futureDate: Date;
};

type DateAddDynamicTest = Assert<
  Equal<DateAddDynamicResult, DateAddDynamicExpected>
>;

// Test 7f: $dateSubtract expression - subtracts time from a date
type DateSubtractSet = {
  oneWeekAgo: {
    $dateSubtract: { startDate: "$updatedAt"; unit: "week"; amount: 1 };
  };
};

type DateSubtractResult = ResolveSetOutput<DateSubtractSet, DateSchema>;

type DateSubtractExpected = {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  count: number;
  oneWeekAgo: Date; // $dateSubtract returns Date
};

type DateSubtractTest = Assert<Equal<DateSubtractResult, DateSubtractExpected>>;

// Test 7g: $toDate expression - converts numeric timestamp to Date
type DateSchemaWithTimestamp = {
  _id: string;
  createdAt: Date;
  timestamp: number; // Unix timestamp in milliseconds
  count: number;
};

type ToDateSet = {
  dateFromTimestamp: { $toDate: "$timestamp" };
};

type ToDateResult = ResolveSetOutput<ToDateSet, DateSchemaWithTimestamp>;

type ToDateExpected = {
  _id: string;
  createdAt: Date;
  timestamp: number;
  count: number;
  dateFromTimestamp: Date; // $toDate returns Date
};

type ToDateTest = Assert<Equal<ToDateResult, ToDateExpected>>;

// Test 7h: $toDate with nested arithmetic expression
type ToDateNestedSet = {
  convertedDate: {
    $toDate: { $multiply: ["$timestamp", 1] };
  };
};

type ToDateNestedResult = ResolveSetOutput<
  ToDateNestedSet,
  DateSchemaWithTimestamp
>;

type ToDateNestedExpected = {
  _id: string;
  createdAt: Date;
  timestamp: number;
  count: number;
  convertedDate: Date;
};

type ToDateNestedTest = Assert<Equal<ToDateNestedResult, ToDateNestedExpected>>;

// ============================================================================
// Test 8: Conditional expressions ($ifNull)
// ============================================================================

type ConditionalSchema = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
};

// Test 8a: $ifNull with field reference and string default
type IfNullStringSet = {
  displayName: { $ifNull: ["$name", "Anonymous"] };
};

type IfNullStringResult = ResolveSetOutput<IfNullStringSet, ConditionalSchema>;

type IfNullStringExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  displayName: "Anonymous" | string; // Returns type of default value
};

type IfNullStringTest = Assert<Equal<IfNullStringResult, IfNullStringExpected>>;

// Test 8b: $ifNull with field reference and numeric default
type IfNullNumberSet = {
  yearsOld: { $ifNull: ["$age", 18] };
};

type IfNullNumberResult = ResolveSetOutput<IfNullNumberSet, ConditionalSchema>;

type IfNullNumberExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  yearsOld: 18 | number;
};

type IfNullNumberTest = Assert<Equal<IfNullNumberResult, IfNullNumberExpected>>;

// Test 8c: $ifNull with two field references
type IfNullTwoFieldsSet = {
  nameOrStatus: { $ifNull: ["$name", "$status"] };
};

type IfNullTwoFieldsResult = ResolveSetOutput<
  IfNullTwoFieldsSet,
  ConditionalSchema
>;

type IfNullTwoFieldsExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  nameOrStatus: string; // Returns type of second expression
};

type IfNullTwoFieldsTest = Assert<
  Equal<IfNullTwoFieldsResult, IfNullTwoFieldsExpected>
>;

// Test 8d: $ifNull with nested expression
type IfNullNestedSet = {
  adjustedAge: {
    $ifNull: ["$age", { $add: [18, 5] }];
  };
};

type IfNullNestedResult = ResolveSetOutput<IfNullNestedSet, ConditionalSchema>;

type IfNullNestedExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  adjustedAge: number; // Returns type of $add expression (number)
};

type IfNullNestedTest = Assert<Equal<IfNullNestedResult, IfNullNestedExpected>>;

// Test 8e: $ifNull with multiple nulls then a field reference
type IfNullMultipleSet = {
  fallbackStatus: { $ifNull: [null, null, "$status"] };
};

type IfNullMultipleResult = ResolveSetOutput<
  IfNullMultipleSet,
  ConditionalSchema
>;

type IfNullMultipleExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  fallbackStatus: string; // Returns type of the last field reference
};

type IfNullMultipleTest = Assert<
  Equal<IfNullMultipleResult, IfNullMultipleExpected>
>;

// Test 8f: $ifNull with 4+ arguments (fallback chain)
type IfNullManyArgsSet = {
  priority: { $ifNull: [null, null, "$name", "default"] };
};

type IfNullManyArgsResult = ResolveSetOutput<
  IfNullManyArgsSet,
  ConditionalSchema
>;

type IfNullManyArgsExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  priority: string; // Union of name type | "default" = string
};

type IfNullManyArgsTest = Assert<
  Equal<IfNullManyArgsResult, IfNullManyArgsExpected>
>;

// Test 9a: Basic $cond with field references
type CondBasicSet = {
  displayName: {
    $cond: [true, "$name", "$email"];
  };
};

type CondBasicResult = ResolveSetOutput<CondBasicSet, ConditionalSchema>;

type CondBasicExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  displayName: string; // Both branches are string fields
};

type CondBasicTest = Assert<Equal<CondBasicResult, CondBasicExpected>>;

// Test 9c: $cond with expressions in true and false branches
type CondWithExpressionsSet = {
  result: {
    $cond: [
      true,
      { $add: [10, 20] }, // expression in true branch
      { $add: [5, 5] }, // expression in false branch
    ];
  };
};

type CondWithExpressionsResult = ResolveSetOutput<
  CondWithExpressionsSet,
  ConditionalSchema
>;

type CondWithExpressionsExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  result: number; // Both branches return number
};

type CondWithExpressionsTest = Assert<
  Equal<CondWithExpressionsResult, CondWithExpressionsExpected>
>;

// Test 9d: $cond returning different types (mixed union)
type CondMixedTypesSet = {
  mixed: {
    $cond: [true, "text", 42];
  };
};

type CondMixedTypesResult = ResolveSetOutput<
  CondMixedTypesSet,
  ConditionalSchema
>;

type CondMixedTypesExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  mixed: "text" | 42; // Union of literal types
};

type CondMixedTypesTest = Assert<
  Equal<CondMixedTypesResult, CondMixedTypesExpected>
>;

// Test 9e: Deeply nested $cond inside $ifNull
type DeepNestedSet = {
  deepValue: {
    $ifNull: [
      null,
      {
        $cond: [true, "nested_true", "nested_false"];
      },
    ];
  };
};

type DeepNestedResult = ResolveSetOutput<DeepNestedSet, ConditionalSchema>;

type DeepNestedExpected = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  deepValue: "nested_true" | "nested_false"; // Union of string literals from $cond
};

type DeepNestedTest = Assert<Equal<DeepNestedResult, DeepNestedExpected>>;

// ============================================================================
// $$REMOVE Tests
// ============================================================================

// Test 8: Removing a simple field with $$REMOVE
type RemoveSimpleFieldSchema = {
  a: string;
  b: number;
  c: boolean;
};

type RemoveSimpleFieldSet = {
  b: "$$REMOVE";
};

type RemoveSimpleFieldResult = ResolveSetOutput<
  RemoveSimpleFieldSet,
  RemoveSimpleFieldSchema
>;

type RemoveSimpleFieldExpected = {
  a: string;
  c: boolean;
};

type RemoveSimpleFieldTest = Assert<
  Equal<RemoveSimpleFieldResult, RemoveSimpleFieldExpected>
>;

// Test 9: Removing nested fields with $$REMOVE
type RemoveNestedFieldSchema = {
  user: {
    name: string;
    email: string;
    age: number;
  };
};

type RemoveNestedFieldSet = {
  "user.email": "$$REMOVE";
};

type RemoveNestedFieldResult = ResolveSetOutput<
  RemoveNestedFieldSet,
  RemoveNestedFieldSchema
>;

type RemoveNestedFieldExpected = {
  user: {
    name: string;
    age: number;
  };
};

type RemoveNestedFieldTest = Assert<
  Equal<RemoveNestedFieldResult, RemoveNestedFieldExpected>
>;

// Test 10: Removing optional fields with $$REMOVE
type RemoveOptionalFieldSchema = {
  required: string;
  optional?: string;
  nested?: {
    a: string;
    b?: number;
  };
};

type RemoveOptionalFieldSet = {
  optional: "$$REMOVE";
  "nested.b": "$$REMOVE";
};

type RemoveOptionalFieldResult = ResolveSetOutput<
  RemoveOptionalFieldSet,
  RemoveOptionalFieldSchema
>;

// FIXED: When using $$REMOVE on nested fields, parent objects stay optional
// Only when actually setting values do parent objects become required
type RemoveOptionalFieldExpected = {
  required: string;
  nested?: {
    a: string;
  };
};

type RemoveOptionalFieldTest = Assert<
  Equal<RemoveOptionalFieldResult, RemoveOptionalFieldExpected>
>;

// Test 11: Mixed operations - setting some fields and removing others
type MixedOperationsSchema = {
  keep: string;
  update: number;
  remove: boolean;
  nested: {
    keep: string;
    update: number;
    remove: boolean;
  };
};

type MixedOperationsSet = {
  update: 42;
  remove: "$$REMOVE";
  "nested.update": 100;
  "nested.remove": "$$REMOVE";
};

type MixedOperationsResult = ResolveSetOutput<
  MixedOperationsSet,
  MixedOperationsSchema
>;

type MixedOperationsExpected = {
  keep: string;
  update: 42;
  nested: {
    keep: string;
    update: 100;
  };
};

type MixedOperationsTest = Assert<
  Equal<MixedOperationsResult, MixedOperationsExpected>
>;

// Test 12: Removing entire nested object
type RemoveEntireObjectSchema = {
  id: string;
  metadata?: {
    created: Date;
    updated: Date;
    tags: string[];
  };
  data: {
    value: number;
  };
};

type RemoveEntireObjectSet = {
  metadata: "$$REMOVE";
};

type RemoveEntireObjectResult = ResolveSetOutput<
  RemoveEntireObjectSet,
  RemoveEntireObjectSchema
>;

type RemoveEntireObjectExpected = {
  id: string;
  data: {
    value: number;
  };
};

type RemoveEntireObjectTest = Assert<
  Equal<RemoveEntireObjectResult, RemoveEntireObjectExpected>
>;

// Test 13: Complex nested removal with preservation
type ComplexRemovalSchema = {
  config: {
    database: {
      host: string;
      port: number;
      credentials?: {
        username: string;
        password: string;
      };
    };
    cache?: {
      enabled: boolean;
      ttl: number;
    };
  };
};

type ComplexRemovalSet = {
  "config.database.credentials": "$$REMOVE";
  "config.cache.ttl": "$$REMOVE";
};

type ComplexRemovalResult = ResolveSetOutput<
  ComplexRemovalSet,
  ComplexRemovalSchema
>;

// FIXED: cache stays optional when only using $$REMOVE on its nested fields
type ComplexRemovalExpected = {
  config: {
    database: {
      host: string;
      port: number;
    };
    cache?: {
      enabled: boolean;
    };
  };
};

type ComplexRemovalTest = Assert<
  Equal<ComplexRemovalResult, ComplexRemovalExpected>
>;

// Satisfy linting by marking unused type aliases
export type {
  BasicOptionalFieldTest,
  NestedOptionalTest,
  NestedPreserveExistingTest,
  NestedFullPreserveExistingTest,
  AddNewFieldTest,
  ArrayElemAtOptionalTest,
  ArrayElemAtNestedOptionalTest,
  ArrayConcatTest,
  SizeExpressionTest,
  SizeLiteralTest,
  SizeNestedTest,
  AddTest,
  DivideTest,
  NestedArithmeticTest,
  MultiplyTest,
  SubtractTest,
  ModTest,
  DateTruncTest,
  DateTruncFullTest,
  DateAddTest,
  DateAddDynamicTest,
  DateSubtractTest,
  ToDateTest,
  ToDateNestedTest,
  IfNullStringTest,
  IfNullNumberTest,
  IfNullTwoFieldsTest,
  IfNullNestedTest,
  IfNullMultipleTest,
  IfNullManyArgsTest,
  CondBasicTest,
  CondWithExpressionsTest,
  CondMixedTypesTest,
  DeepNestedTest,
  RemoveSimpleFieldTest,
  RemoveNestedFieldTest,
  RemoveOptionalFieldTest,
  MixedOperationsTest,
  RemoveEntireObjectTest,
  ComplexRemovalTest,
};
