import { Assert, Equal } from "../utils/tests";
import { ResolveUnsetOutput } from "./unset";

/**
 * Type Resolution Behaviors for $unset Stage:
 *
 * FEATURES:
 * 1. SINGLE FIELD REMOVAL:
 *    The $unset stage can remove a single field using a string path.
 *    Example: "age" removes the age field from the document
 *
 * 2. MULTIPLE FIELD REMOVAL:
 *    Can remove multiple fields using an array of field paths.
 *    Example: ["age", "email"] removes both fields
 *
 * 3. NESTED FIELD REMOVAL:
 *    Supports dotted notation for removing nested fields.
 *    Example: "user.profile.email" removes the nested email field
 *
 * 4. OPTIONAL FIELD HANDLING:
 *    When removing nested fields from optional parent objects, the parent
 *    should remain optional if only removal operations are performed.
 *
 * 5. LEVERAGES $set WITH $$REMOVE:
 *    $unset is implemented using $set with $$REMOVE values.
 *    All $set $$REMOVE behaviors apply to $unset.
 *
 * These tests use Assert<Equal> which checks exact type equality.
 * All tests should pass correctly with proper type inference.
 */

// ============================================================================
// Single Field Removal
// ============================================================================

// Test 1: Remove a simple top-level field
type SimpleSchema = {
  name: string;
  age: number;
  email: string;
};

type RemoveSingleFieldResult = ResolveUnsetOutput<"age", SimpleSchema>;

type RemoveSingleFieldExpected = {
  name: string;
  email: string;
};

type RemoveSingleFieldTest = Assert<
  Equal<RemoveSingleFieldResult, RemoveSingleFieldExpected>
>;

// Test 2: Remove a different field
type RemoveEmailResult = ResolveUnsetOutput<"email", SimpleSchema>;

type RemoveEmailExpected = {
  name: string;
  age: number;
};

type RemoveEmailTest = Assert<Equal<RemoveEmailResult, RemoveEmailExpected>>;

// ============================================================================
// Multiple Field Removal (Array Syntax)
// ============================================================================

// Test 3: Remove multiple fields at once
type RemoveMultipleResult = ResolveUnsetOutput<["age", "email"], SimpleSchema>;

type RemoveMultipleExpected = {
  name: string;
};

type RemoveMultipleTest = Assert<
  Equal<RemoveMultipleResult, RemoveMultipleExpected>
>;

// Test 4: Remove all but one field
type RemoveMostFieldsResult = ResolveUnsetOutput<["name", "age"], SimpleSchema>;

type RemoveMostFieldsExpected = {
  email: string;
};

type RemoveMostFieldsTest = Assert<
  Equal<RemoveMostFieldsResult, RemoveMostFieldsExpected>
>;

// ============================================================================
// Nested Field Removal
// ============================================================================

// Test 5: Remove a nested field
type NestedSchema = {
  user: {
    name: string;
    email: string;
    age: number;
  };
  status: string;
};

type RemoveNestedFieldResult = ResolveUnsetOutput<"user.email", NestedSchema>;

type RemoveNestedFieldExpected = {
  user: {
    name: string;
    age: number;
  };
  status: string;
};

type RemoveNestedFieldTest = Assert<
  Equal<RemoveNestedFieldResult, RemoveNestedFieldExpected>
>;

// Test 6: Remove multiple nested fields
type RemoveMultipleNestedResult = ResolveUnsetOutput<
  ["user.email", "user.age"],
  NestedSchema
>;

type RemoveMultipleNestedExpected = {
  user: {
    name: string;
  };
  status: string;
};

type RemoveMultipleNestedTest = Assert<
  Equal<RemoveMultipleNestedResult, RemoveMultipleNestedExpected>
>;

// ============================================================================
// Removing Entire Nested Objects
// ============================================================================

// Test 7: Remove an entire nested object
type RemoveEntireObjectResult = ResolveUnsetOutput<"user", NestedSchema>;

type RemoveEntireObjectExpected = {
  status: string;
};

type RemoveEntireObjectTest = Assert<
  Equal<RemoveEntireObjectResult, RemoveEntireObjectExpected>
>;

// Test 8: Remove multiple top-level and nested fields
type MixedRemovalSchema = {
  id: string;
  metadata: {
    created: Date;
    updated: Date;
  };
  data: {
    value: number;
  };
};

type MixedRemovalResult = ResolveUnsetOutput<
  ["metadata.created", "data"],
  MixedRemovalSchema
>;

type MixedRemovalExpected = {
  id: string;
  metadata: {
    updated: Date;
  };
};

type MixedRemovalTest = Assert<Equal<MixedRemovalResult, MixedRemovalExpected>>;

// ============================================================================
// Optional Fields
// ============================================================================

// Test 9: Remove an optional field
type OptionalFieldSchema = {
  required: string;
  optional?: string;
  nested: {
    required: number;
    optional?: boolean;
  };
};

type RemoveOptionalFieldResult = ResolveUnsetOutput<
  "optional",
  OptionalFieldSchema
>;

type RemoveOptionalFieldExpected = {
  required: string;
  nested: {
    required: number;
    optional?: boolean;
  };
};

type RemoveOptionalFieldTest = Assert<
  Equal<RemoveOptionalFieldResult, RemoveOptionalFieldExpected>
>;

// Test 10: Remove nested optional field, parent stays optional
type RemoveNestedOptionalResult = ResolveUnsetOutput<
  "nested.optional",
  OptionalFieldSchema
>;

type RemoveNestedOptionalExpected = {
  required: string;
  optional?: string;
  nested: {
    required: number;
  };
};

type RemoveNestedOptionalTest = Assert<
  Equal<RemoveNestedOptionalResult, RemoveNestedOptionalExpected>
>;

// ============================================================================
// Optional Parent Objects
// ============================================================================

// Test 11: Remove field from optional parent object
type OptionalParentSchema = {
  required: string;
  nested?: {
    a: string;
    b: number;
  };
};

type RemoveFromOptionalParentResult = ResolveUnsetOutput<
  "nested.b",
  OptionalParentSchema
>;

// Parent stays optional when only removing fields
type RemoveFromOptionalParentExpected = {
  required: string;
  nested?: {
    a: string;
  };
};

type RemoveFromOptionalParentTest = Assert<
  Equal<RemoveFromOptionalParentResult, RemoveFromOptionalParentExpected>
>;

// Test 12: Remove entire optional parent
type RemoveOptionalParentResult = ResolveUnsetOutput<
  "nested",
  OptionalParentSchema
>;

type RemoveOptionalParentExpected = {
  required: string;
};

type RemoveOptionalParentTest = Assert<
  Equal<RemoveOptionalParentResult, RemoveOptionalParentExpected>
>;

// ============================================================================
// Deep Nesting
// ============================================================================

// Test 13: Remove deeply nested field
type DeepNestedSchema = {
  config: {
    database: {
      connection: {
        host: string;
        port: number;
        timeout: number;
      };
    };
  };
};

type RemoveDeepNestedResult = ResolveUnsetOutput<
  "config.database.connection.timeout",
  DeepNestedSchema
>;

type RemoveDeepNestedExpected = {
  config: {
    database: {
      connection: {
        host: string;
        port: number;
      };
    };
  };
};

type RemoveDeepNestedTest = Assert<
  Equal<RemoveDeepNestedResult, RemoveDeepNestedExpected>
>;

// Test 14: Remove multiple deeply nested fields
type RemoveMultipleDeepResult = ResolveUnsetOutput<
  ["config.database.connection.timeout", "config.database.connection.port"],
  DeepNestedSchema
>;

type RemoveMultipleDeepExpected = {
  config: {
    database: {
      connection: {
        host: string;
      };
    };
  };
};

type RemoveMultipleDeepTest = Assert<
  Equal<RemoveMultipleDeepResult, RemoveMultipleDeepExpected>
>;

// ============================================================================
// Complex Scenarios
// ============================================================================

// Test 15: Remove fields at different nesting levels
type ComplexSchema = {
  id: string;
  metadata: {
    created: Date;
    updated: Date;
    tags: string[];
  };
  user: {
    profile: {
      name: string;
      email: string;
    };
    settings: {
      theme: string;
      notifications: boolean;
    };
  };
};

type ComplexRemovalResult = ResolveUnsetOutput<
  ["metadata.tags", "user.profile.email", "user.settings"],
  ComplexSchema
>;

type ComplexRemovalExpected = {
  id: string;
  metadata: {
    created: Date;
    updated: Date;
  };
  user: {
    profile: {
      name: string;
    };
  };
};

type ComplexRemovalTest = Assert<
  Equal<ComplexRemovalResult, ComplexRemovalExpected>
>;

// Test 16: Remove all fields except one
type RemoveAllButOneSchema = {
  keep: string;
  remove1: number;
  remove2: boolean;
  remove3: Date;
};

type RemoveAllButOneResult = ResolveUnsetOutput<
  ["remove1", "remove2", "remove3"],
  RemoveAllButOneSchema
>;

type RemoveAllButOneExpected = {
  keep: string;
};

type RemoveAllButOneTest = Assert<
  Equal<RemoveAllButOneResult, RemoveAllButOneExpected>
>;

// ============================================================================
// Edge Cases
// ============================================================================

// Test 17: Empty array (edge case - should preserve schema)
type EmptyArrayResult = ResolveUnsetOutput<[], SimpleSchema>;

// Note: This is an edge case - empty array should preserve schema
type EmptyArrayExpected = SimpleSchema;

type EmptyArrayTest = Assert<Equal<EmptyArrayResult, EmptyArrayExpected>>;

// Test 18: Remove with mixed optional and required fields
type MixedOptionalSchema = {
  required1: string;
  optional1?: string;
  nested: {
    required2: number;
    optional2?: number;
  };
  optional3?: {
    field: string;
  };
};

type RemoveMixedOptionalResult = ResolveUnsetOutput<
  ["optional1", "nested.optional2", "optional3"],
  MixedOptionalSchema
>;

type RemoveMixedOptionalExpected = {
  required1: string;
  nested: {
    required2: number;
  };
};

type RemoveMixedOptionalTest = Assert<
  Equal<RemoveMixedOptionalResult, RemoveMixedOptionalExpected>
>;

// Satisfy linting by exporting all test types
export type {
  RemoveSingleFieldTest,
  RemoveEmailTest,
  RemoveMultipleTest,
  RemoveMostFieldsTest,
  RemoveNestedFieldTest,
  RemoveMultipleNestedTest,
  RemoveEntireObjectTest,
  MixedRemovalTest,
  RemoveOptionalFieldTest,
  RemoveNestedOptionalTest,
  RemoveFromOptionalParentTest,
  RemoveOptionalParentTest,
  RemoveDeepNestedTest,
  RemoveMultipleDeepTest,
  ComplexRemovalTest,
  RemoveAllButOneTest,
  EmptyArrayTest,
  RemoveMixedOptionalTest,
};
