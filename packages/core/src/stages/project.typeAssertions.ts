import {
  Assert,
  AssertPipeSafeError,
  Equal,
  NotImplemented,
  IsAssignable,
} from "../utils/tests";
import { ResolveProjectOutput, ProjectQuery } from "./project";

/**
 * Type Resolution Tests for $project Stage
 *
 * These tests are expected to fail until the implementation is complete.
 * They serve as a specification for the expected behavior.
 *
 * FEATURES TO IMPLEMENT:
 * 1. FIELD INCLUSION: Include specific fields using { field: 1 } or { field: true }
 * 2. FIELD EXCLUSION: Exclude specific fields using { field: 0 } or { field: false }
 * 3. FIELD RENAMING: Rename fields using { newName: "$oldName" }
 * 4. COMPUTED FIELDS: Add computed fields using expressions
 * 5. NESTED RESHAPING: Reshape nested structures
 */

// ============================================================================
// Test 1: Basic field inclusion
// ============================================================================
type BasicIncludeSchema = {
  name: string;
  age: number;
  email: string;
};

type BasicIncludeProject = {
  name: 1;
  age: true;
};

type BasicIncludeResult = ResolveProjectOutput<
  BasicIncludeSchema,
  BasicIncludeProject
>;

type BasicIncludeExpected = {
  name: string;
  age: number;
};

type BasicIncludeTest = Assert<Equal<BasicIncludeResult, BasicIncludeExpected>>;

// ============================================================================
// Test 2: Basic field exclusion
// ============================================================================
type BasicExcludeSchema = {
  name: string;
  age: number;
  email: string;
};

type BasicExcludeProject = {
  email: 0;
};

type BasicExcludeResult = ResolveProjectOutput<
  BasicExcludeSchema,
  BasicExcludeProject
>;

type BasicExcludeExpected = {
  name: string;
  age: number;
};

type BasicExcludeTest = Assert<Equal<BasicExcludeResult, BasicExcludeExpected>>;

// ============================================================================
// Test 3: Field renaming
// ============================================================================
type RenameSchema = {
  firstName: string;
  lastName: string;
};

type RenameProject = {
  first: "$firstName";
  last: "$lastName";
};

type RenameResult = ResolveProjectOutput<RenameSchema, RenameProject>;

type RenameExpected = {
  first: string;
  last: string;
};

type RenameTest = Assert<Equal<RenameResult, RenameExpected>>;

// ============================================================================
// Test 3b: Dot key assignment to field reference
// ============================================================================
type DotKeyAssignSchema = {
  user: {
    profile: {
      firstName: string;
      lastName: string;
    };
  };
  metadata: {
    created: Date;
  };
};

type DotKeyAssignProject = {
  firstName: "$user.profile.firstName";
  lastName: "$user.profile.lastName";
  created: "$metadata.created";
};

type DotKeyAssignResult = ResolveProjectOutput<
  DotKeyAssignSchema,
  DotKeyAssignProject
>;

type DotKeyAssignExpected = {
  firstName: string;
  lastName: string;
  created: Date;
};

type DotKeyAssignTest = Assert<Equal<DotKeyAssignResult, DotKeyAssignExpected>>;

// ============================================================================
// Test 4: Mixed inclusion and exclusion — rejected (MongoDB forbids this)
// ============================================================================
// Previously this test asserted that `{ id: 1, fullName: "$name", email: false }`
// produced `{ id: string; fullName: string }` (exclusion of `email` plus
// inclusion of `id` and computed `fullName`). MongoDB actually rejects this
// at runtime: you can only mix when excluding `_id` from an otherwise-
// inclusion projection. With the typed-error rollout the dispatch now
// produces a branded `PipeSafeError` instead of silently picking a mode.
type MixedSchema = {
  id: string;
  name: string;
  email: string;
  age: number;
};

type MixedProject = {
  id: 1;
  fullName: "$name";
  email: false;
};

type MixedResult = ResolveProjectOutput<MixedSchema, MixedProject>;

type MixedTest = Assert<
  AssertPipeSafeError<
    MixedResult,
    "Stage '$project' cannot mix inclusion 1/true and exclusion 0/false."
  >
>;

// `_id`-only exclusion is the documented exception — should still type-check
// in pure inclusion mode without a brand.
type IdExclusionSchema = { _id: string; name: string; age: number };
type IdExclusionProject = { name: 1; age: 1; _id: 0 };
type IdExclusionResult = ResolveProjectOutput<
  IdExclusionSchema,
  IdExclusionProject
>;
type IdExclusionTest = Assert<
  Equal<IdExclusionResult, { name: string; age: number }>
>;

// ============================================================================
// Test 5: Nested field projection
// ============================================================================
type NestedSchema = {
  user: {
    name: string;
    email: string;
    age: number;
  };
  status: string;
};

type NestedProject = {
  "user.name": 1;
  "user.email": 1;
  status: 1;
};

type NestedResult = ResolveProjectOutput<NestedSchema, NestedProject>;

type NestedExpected = {
  user: {
    name: string;
    email: string;
  };
  status: string;
};

type NestedTest = Assert<Equal<NestedResult, NestedExpected>>;

// ============================================================================
// Test 5b: Nested object replacement (replaces entire object, doesn't retain siblings)
// ============================================================================
type NestedReplaceSchema = {
  user: {
    name: string;
    email: string;
    age: number;
  };
  status: string;
};

type NestedReplaceProject = {
  user: { name: "Bob" };
  status: 1;
};

type NestedReplaceResult = ResolveProjectOutput<
  NestedReplaceSchema,
  NestedReplaceProject
>;

type NestedReplaceExpected = {
  user: {
    name: "Bob";
  };
  status: string;
};

type NestedReplaceTest = Assert<
  Equal<NestedReplaceResult, NestedReplaceExpected>
>;

// ============================================================================
// Test 6: _id field - explicit inclusion
// ============================================================================
type IdIncludeSchema = {
  _id: string;
  name: string;
  age: number;
};

type IdIncludeProject = {
  _id: 1;
  name: 1;
};

type IdIncludeResult = ResolveProjectOutput<IdIncludeSchema, IdIncludeProject>;

type IdIncludeExpected = {
  _id: string;
  name: string;
};

type IdIncludeTest = Assert<Equal<IdIncludeResult, IdIncludeExpected>>;

// ============================================================================
// Test 7: _id field - explicit exclusion
// ============================================================================
type IdExcludeSchema = {
  _id: string;
  name: string;
  age: number;
};

type IdExcludeProject = {
  _id: 0;
  name: 1;
  age: 1;
};

type IdExcludeResult = ResolveProjectOutput<IdExcludeSchema, IdExcludeProject>;

type IdExcludeExpected = {
  name: string;
  age: number;
};

type IdExcludeTest = Assert<Equal<IdExcludeResult, IdExcludeExpected>>;

// ============================================================================
// Test 8: _id field - implicit inclusion (default behavior)
// When including fields, _id is included by default unless explicitly excluded
// ============================================================================
type IdImplicitIncludeSchema = {
  _id: string;
  name: string;
  email: string;
};

type IdImplicitIncludeProject = {
  name: 1;
  email: 1;
};

type IdImplicitIncludeResult = ResolveProjectOutput<
  IdImplicitIncludeSchema,
  IdImplicitIncludeProject
>;

type IdImplicitIncludeExpected = {
  _id: string;
  name: string;
  email: string;
};

type IdImplicitIncludeTest = Assert<
  Equal<IdImplicitIncludeResult, IdImplicitIncludeExpected>
>;

// ============================================================================
// Test 9: _id field - exclusion with field renaming
// ============================================================================
type IdExcludeWithRenameSchema = {
  _id: string;
  firstName: string;
  lastName: string;
};

type IdExcludeWithRenameProject = {
  _id: false;
  first: "$firstName";
  last: "$lastName";
};

type IdExcludeWithRenameResult = ResolveProjectOutput<
  IdExcludeWithRenameSchema,
  IdExcludeWithRenameProject
>;

type IdExcludeWithRenameExpected = {
  first: string;
  last: string;
};

type IdExcludeWithRenameTest = Assert<
  Equal<IdExcludeWithRenameResult, IdExcludeWithRenameExpected>
>;

// ============================================================================
// Test 10: _id field - explicit inclusion with boolean true
// ============================================================================
type IdIncludeBooleanSchema = {
  _id: string;
  name: string;
};

type IdIncludeBooleanProject = {
  _id: true;
  name: 1;
};

type IdIncludeBooleanResult = ResolveProjectOutput<
  IdIncludeBooleanSchema,
  IdIncludeBooleanProject
>;

type IdIncludeBooleanExpected = {
  _id: string;
  name: string;
};

type IdIncludeBooleanTest = Assert<
  Equal<IdIncludeBooleanResult, IdIncludeBooleanExpected>
>;

// ============================================================================
// Test 11: Illegal - mixing include and exclude (without _id exception)
// Should NOT be assignable to ProjectQuery
// ============================================================================
type IllegalMixSchema = {
  name: string;
  email: string;
  age: number;
};

// This should be illegal: mixing include (name: 1) and exclude (email: 0)
// without _id being involved
type IllegalMixProject = {
  name: 1;
  email: 0;
};

// Expected: This should NOT be assignable to ProjectQuery
type IllegalMixIsAssignable = IsAssignable<
  IllegalMixProject,
  ProjectQuery<IllegalMixSchema>
>;

type IllegalMixTest = Assert<
  NotImplemented<Equal<IllegalMixIsAssignable, false>>
>;

// ============================================================================
// Test 12: Illegal - including _id and other fields while excluding another
// Should NOT be assignable to ProjectQuery
// ============================================================================
type IllegalMixWithIdSchema = {
  _id: string;
  name: string;
  email: string;
  age: number;
};

// This should be illegal: including _id and name, but excluding email
// You can't mix include/exclude even when _id is included
type IllegalMixWithIdProject = {
  _id: 1;
  name: 1;
  email: 0;
};

// Expected: This should NOT be assignable to ProjectQuery
type IllegalMixWithIdIsAssignable = IsAssignable<
  IllegalMixWithIdProject,
  ProjectQuery<IllegalMixWithIdSchema>
>;

type IllegalMixWithIdTest = Assert<
  NotImplemented<Equal<IllegalMixWithIdIsAssignable, false>>
>;

// Satisfy linting by exporting all test types
// ============================================================================
// Test 13: $size expression operator
// ============================================================================
type SizeExpressionSchema = {
  items: string[];
  tags: string[];
  metadata: {
    categories: number[];
  };
  count?: number[];
};

type SizeExpressionProject = {
  itemCount: { $size: "$items" };
  tagCount: { $size: "$tags" };
  categoryCount: { $size: "$metadata.categories" };
};

type SizeExpressionResult = ResolveProjectOutput<
  SizeExpressionSchema,
  SizeExpressionProject
>;

type SizeExpressionExpected = {
  itemCount: number;
  tagCount: number;
  categoryCount: number;
};

type SizeExpressionTest = Assert<
  Equal<SizeExpressionResult, SizeExpressionExpected>
>;

// Test 13b: $size with array literal
type SizeLiteralProject = {
  fixedSize: { $size: [1, 2, 3, 4, 5] };
};

type SizeLiteralResult = ResolveProjectOutput<
  SizeExpressionSchema,
  SizeLiteralProject
>;

type SizeLiteralExpected = {
  fixedSize: number;
};

type SizeLiteralTest = Assert<Equal<SizeLiteralResult, SizeLiteralExpected>>;

// Test 13c: $size mixed with other projection features
type SizeMixedProject = {
  _id: 0;
  name: 1;
  itemCount: { $size: "$items" };
  renamedTags: "$tags";
};

type SizeMixedResult = ResolveProjectOutput<
  SizeExpressionSchema & { _id: string; name: string },
  SizeMixedProject
>;

type SizeMixedExpected = {
  name: string;
  itemCount: number;
  renamedTags: string[];
};

type SizeMixedTest = Assert<Equal<SizeMixedResult, SizeMixedExpected>>;

// ============================================================================
// Test 13d: $concat expression
// ============================================================================
type ConcatProjectSchema = {
  firstName: string;
  lastName: string;
  prefix: string;
  suffix: string;
};

type ConcatProject = {
  fullName: { $concat: ["$firstName", " ", "$lastName"] };
};

type ConcatProjectResult = ResolveProjectOutput<
  ConcatProjectSchema,
  ConcatProject
>;

type ConcatProjectExpected = {
  fullName: string;
};

export type ConcatProjectTest = Assert<
  Equal<ConcatProjectResult, ConcatProjectExpected>
>;

// ============================================================================
// Test 14: Nested field references
// ============================================================================
type NestedFieldRefSchema = {
  c: string;
  d: number;
  nested: {
    value: string;
  };
};

type NestedFieldRefProject = {
  a: {
    b: "$c";
  };
  nestedValue: {
    inner: "$d";
    deep: {
      value: "$nested.value";
    };
  };
};

type NestedFieldRefResult = ResolveProjectOutput<
  NestedFieldRefSchema,
  NestedFieldRefProject
>;

type NestedFieldRefExpected = {
  a: {
    b: string;
  };
  nestedValue: {
    inner: number;
    deep: {
      value: string;
    };
  };
};

type NestedFieldRefTest = Assert<
  Equal<NestedFieldRefResult, NestedFieldRefExpected>
>;

// Test 14b: Nested field references with expressions
type NestedFieldRefExprProject = {
  wrapper: {
    count: { $size: "$items" };
    renamed: "$name";
  };
};

type NestedFieldRefExprResult = ResolveProjectOutput<
  NestedFieldRefSchema & { items: string[]; name: string },
  NestedFieldRefExprProject
>;

type NestedFieldRefExprExpected = {
  wrapper: {
    count: number;
    renamed: string;
  };
};

type NestedFieldRefExprTest = Assert<
  Equal<NestedFieldRefExprResult, NestedFieldRefExprExpected>
>;

// ============================================================================
// Test 15: $dateToString expression operator
// ============================================================================
type DateToStringSchema = {
  timestamp: Date;
  createdAt: Date;
  metadata: {
    updatedAt: Date;
  };
};

type DateToStringProject = {
  dateString: {
    $dateToString: {
      format: "%Y-%m-%d";
      date: "$timestamp";
    };
  };
  createdDate: {
    $dateToString: {
      format: "%Y-%m-%d";
      date: "$createdAt";
      timezone: "UTC";
    };
  };
};

type DateToStringResult = ResolveProjectOutput<
  DateToStringSchema,
  DateToStringProject
>;

type DateToStringExpected = {
  dateString: string;
  createdDate: string;
};

type DateToStringTest = Assert<Equal<DateToStringResult, DateToStringExpected>>;

// Test 15b: $dateToString with nested date field
type DateToStringNestedProject = {
  updatedDate: {
    $dateToString: {
      format: "%Y-%m-%d";
      date: "$metadata.updatedAt";
    };
  };
};

type DateToStringNestedResult = ResolveProjectOutput<
  DateToStringSchema,
  DateToStringNestedProject
>;

type DateToStringNestedExpected = {
  updatedDate: string;
};

type DateToStringNestedTest = Assert<
  Equal<DateToStringNestedResult, DateToStringNestedExpected>
>;

// Test 15c: $dateToString mixed with other projection features
type DateToStringMixedProject = {
  _id: 0;
  name: 1;
  formattedDate: {
    $dateToString: {
      format: "%Y-%m-%d";
      date: "$timestamp";
    };
  };
  renamedTimestamp: "$createdAt";
};

type DateToStringMixedResult = ResolveProjectOutput<
  DateToStringSchema & { _id: string; name: string },
  DateToStringMixedProject
>;

type DateToStringMixedExpected = {
  name: string;
  formattedDate: string;
  renamedTimestamp: Date;
};

type DateToStringMixedTest = Assert<
  Equal<DateToStringMixedResult, DateToStringMixedExpected>
>;

// ============================================================================
// Test 15d: $dateTrunc expression operator (returns Date)
// ============================================================================
type DateTruncProjectSchema = {
  _id: string;
  timestamp: Date;
  createdAt: Date;
};

type DateTruncProject = {
  _id: 0;
  eventDay: {
    $dateTrunc: {
      date: "$timestamp";
      unit: "day";
    };
  };
  createdWeek: {
    $dateTrunc: {
      date: "$createdAt";
      unit: "week";
      startOfWeek: "monday";
    };
  };
};

type DateTruncProjectResult = ResolveProjectOutput<
  DateTruncProjectSchema,
  DateTruncProject
>;

type DateTruncProjectExpected = {
  eventDay: Date;
  createdWeek: Date;
};

type DateTruncProjectTest = Assert<
  Equal<DateTruncProjectResult, DateTruncProjectExpected>
>;

// ============================================================================
// Test 15e: $dateAdd and $dateSubtract expressions (return Date)
// ============================================================================
type DateAddSubtractProject = {
  _id: 0;
  expiresAt: {
    $dateAdd: {
      startDate: "$timestamp";
      unit: "day";
      amount: 30;
    };
  };
  startedAt: {
    $dateSubtract: {
      startDate: "$createdAt";
      unit: "hour";
      amount: 24;
    };
  };
};

type DateAddSubtractProjectResult = ResolveProjectOutput<
  DateTruncProjectSchema,
  DateAddSubtractProject
>;

type DateAddSubtractProjectExpected = {
  expiresAt: Date;
  startedAt: Date;
};

type DateAddSubtractProjectTest = Assert<
  Equal<DateAddSubtractProjectResult, DateAddSubtractProjectExpected>
>;

// ============================================================================
// Test 16: Arithmetic expressions
// ============================================================================
type ArithmeticProjectSchema = {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  price: number;
  quantity: number;
  discount: number;
  basePrice: number;
};

// Test 16a: $add expression
type AddProject = {
  totalEngagement: { $add: ["$totalLikes", "$totalComments"] };
};

type AddProjectResult = ResolveProjectOutput<
  ArithmeticProjectSchema,
  AddProject
>;

type AddProjectExpected = {
  totalEngagement: number;
};

type AddProjectTest = Assert<Equal<AddProjectResult, AddProjectExpected>>;

// Test 16b: $divide expression with nested $add
type DivideNestedProject = {
  engagementRate: {
    $divide: [{ $add: ["$totalLikes", "$totalComments"] }, "$totalViews"];
  };
};

type DivideNestedProjectResult = ResolveProjectOutput<
  ArithmeticProjectSchema,
  DivideNestedProject
>;

type DivideNestedProjectExpected = {
  engagementRate: number;
};

type DivideNestedProjectTest = Assert<
  Equal<DivideNestedProjectResult, DivideNestedProjectExpected>
>;

// Test 16c: Multiple arithmetic expressions
type MultipleArithmeticProject = {
  _id: 0;
  totalPrice: { $multiply: ["$price", "$quantity"] };
  finalPrice: { $subtract: ["$basePrice", "$discount"] };
  remainder: { $mod: ["$totalViews", 7] };
};

type MultipleArithmeticProjectResult = ResolveProjectOutput<
  ArithmeticProjectSchema & { _id: string },
  MultipleArithmeticProject
>;

type MultipleArithmeticProjectExpected = {
  totalPrice: number;
  finalPrice: number;
  remainder: number;
};

type MultipleArithmeticProjectTest = Assert<
  Equal<MultipleArithmeticProjectResult, MultipleArithmeticProjectExpected>
>;

export type {
  BasicIncludeTest,
  BasicExcludeTest,
  RenameTest,
  DotKeyAssignTest,
  MixedTest,
  IdExclusionTest,
  NestedTest,
  NestedReplaceTest,
  IdIncludeTest,
  IdExcludeTest,
  IdImplicitIncludeTest,
  IdExcludeWithRenameTest,
  IdIncludeBooleanTest,
  IllegalMixTest,
  IllegalMixWithIdTest,
  SizeExpressionTest,
  SizeLiteralTest,
  SizeMixedTest,
  NestedFieldRefTest,
  NestedFieldRefExprTest,
  DateToStringTest,
  DateToStringNestedTest,
  DateToStringMixedTest,
  DateTruncProjectTest,
  DateAddSubtractProjectTest,
  AddProjectTest,
  DivideNestedProjectTest,
  MultipleArithmeticProjectTest,
};

// ============================================================================
// Phase D — Typed projection errors
// ============================================================================
// `ResolveFieldValue` and `ResolveProjectOutput` now return branded
// `PipeSafeError` types at three otherwise-silent failure sites:
//   1. Inclusion of a field that doesn't exist on the schema (`{ unknownKey: 1 }`)
//      — including via a widened number/boolean flag (any number is a valid
//      FLAG per MongoDB's nonzero-includes rule, so a bad KEY is the error).
//   2. A value that is none of flag/ref/expression/object/string —
//      `Invalid projection value for field '...'.` (e.g. null/undefined).
//   3. Mixed inclusion and exclusion in the same projection.

type ProjectErrorSchema = {
  name: string;
  age: number;
};

// 1. Including a key not on the schema produces a branded error at that key.
type _UnknownInclusionResult = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 1; unknownKey: 1 }
>;
type _Assert_UnknownInclusion = Assert<
  AssertPipeSafeError<
    _UnknownInclusionResult["unknownKey"],
    "Field 'unknownKey' is not on the schema."
  >
>;

// 2. Any number is a valid projection FLAG (MongoDB: nonzero includes), so
//    `bogus: 99` on an UNKNOWN key brands as an unknown field — not as an
//    invalid value — and on a known key it includes the field.
type _NonZeroFlagUnknownKey = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 1; bogus: 99 }
>;
type _Assert_NonZeroFlagUnknownKey = Assert<
  AssertPipeSafeError<
    _NonZeroFlagUnknownKey["bogus"],
    "Field 'bogus' is not on the schema."
  >
>;
type _NonZeroFlagKnownKey = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 99 }
>;
type _Assert_NonZeroFlagIncludes = Assert<
  Equal<_NonZeroFlagKnownKey["name"], ProjectErrorSchema["name"]>
>;

// The Invalid-value brand itself stays pinned (resolver-level: null is not
// a valid projection value; the Query constraint rejects it before the
// resolver in the chained API, but the message must not drift silently).
type _InvalidValueStillBranded = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 1; bogus: null }
>;
type _Assert_InvalidValueBrand = Assert<
  AssertPipeSafeError<
    _InvalidValueStillBranded["bogus"],
    "Invalid projection value for field 'bogus'."
  >
>;

// 3. Mixed inclusion and exclusion produces a branded error on the result
//    type (MongoDB rejects this at runtime; only `_id` exclusion is allowed).
type _MixedModeResult = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 1; age: 0 }
>;
type _Assert_MixedMode = Assert<
  AssertPipeSafeError<
    _MixedModeResult,
    "Stage '$project' cannot mix inclusion 1/true and exclusion 0/false."
  >
>;

// 4. Positive sweep — a fully valid inclusion still produces the expected
//    structural output (no brand leakage). Note: _id is dropped, not `never`.
type _ValidInclusionResult = ResolveProjectOutput<
  ProjectErrorSchema,
  { name: 1 }
>;
type _Assert_ValidInclusion = Assert<
  Equal<_ValidInclusionResult, { name: string }>
>;

export type {
  _Assert_UnknownInclusion,
  _Assert_NonZeroFlagUnknownKey,
  _Assert_NonZeroFlagIncludes,
  _Assert_InvalidValueBrand,
  _Assert_MixedMode,
  _Assert_ValidInclusion,
};
