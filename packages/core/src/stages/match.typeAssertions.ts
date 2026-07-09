import {
  Assert,
  AssertPipeSafeError,
  Equal,
  IsAssignable,
} from "../utils/tests";
import {
  ComparatorMatchers,
  FIELD_MATCH_OPERATORS,
  LogicalMatchOperators,
  Notted,
  ResolveMatchOutput,
  TOP_LEVEL_MATCH_OPERATORS,
} from "./match";

/**
 * Type Resolution Behaviors for $match Stage:
 *
 * FEATURES:
 * 1. UNION TYPE NARROWING (Core Feature):
 *    The $match stage can narrow union types based on query conditions.
 *    When matching on a discriminator field, TypeScript filters the union
 *    to only include matching types.
 *    Example: Matching { type: "speaker" } on Speaker | Attendee union
 *             produces only Speaker type
 *
 * 2. FIELD-LEVEL TYPE NARROWING:
 *    Queries narrow not just on discriminators but on any field where
 *    the union members have different types.
 *    Example: { age: { $exists: true } } filters to union members that have age
 *
 * 3. COMPARISON OPERATORS:
 *    Supports $eq, $ne, $gt, $gte, $lt, $lte for numbers and dates
 *    Maintains type safety by ensuring operators match field types
 *
 * 4. ARRAY OPERATORS:
 *    $size, $in, $nin, $all, $elemMatch for array field queries
 *    Type-safe element matching and array length checking
 *
 * 5. LOGICAL OPERATORS:
 *    $and, $or, $nor for combining queries
 *    Currently preserves full schema (no narrowing for complex operators)
 *
 * These tests use Assert<Equal> which checks structural compatibility.
 * All tests should pass correctly with proper type inference.
 */

// ============================================================================
// Basic Equality Matching
// ============================================================================

// Test 1: Simple field equality
type SimpleEqualitySchema = {
  name: string;
  age: number;
};

type SimpleEqualityQuery = {
  name: "Alice";
};

type SimpleEqualityResult = ResolveMatchOutput<
  SimpleEqualitySchema,
  SimpleEqualityQuery
>;

type SimpleEqualityExpected = {
  name: string;
  age: number;
};

type SimpleEqualityTest = Assert<
  Equal<SimpleEqualityResult, SimpleEqualityExpected>
>;

// Test 2: Field equality with $eq operator
type ExplicitEqSchema = {
  status: string;
  count: number;
};

type ExplicitEqQuery = {
  status: { $eq: "active" };
};

type ExplicitEqResult = ResolveMatchOutput<ExplicitEqSchema, ExplicitEqQuery>;

type ExplicitEqExpected = {
  status: string;
  count: number;
};

type ExplicitEqTest = Assert<Equal<ExplicitEqResult, ExplicitEqExpected>>;

// ============================================================================
// Union Type Narrowing (Core Feature)
// ============================================================================

// Test 3: Discriminated union narrowing - single type
type Person =
  | {
      type: "speaker";
      name: string;
      topic: string;
    }
  | {
      type: "attendee";
      name: string;
      ticketNumber: number;
    };

type SpeakerQuery = {
  type: "speaker";
};

type SpeakerResult = ResolveMatchOutput<Person, SpeakerQuery>;

type SpeakerExpected = {
  type: "speaker";
  name: string;
  topic: string;
};

type SpeakerTest = Assert<Equal<SpeakerResult, SpeakerExpected>>;

// Test 4: Discriminated union narrowing - attendee type
type AttendeeQuery = {
  type: "attendee";
};

type AttendeeResult = ResolveMatchOutput<Person, AttendeeQuery>;

type AttendeeExpected = {
  type: "attendee";
  name: string;
  ticketNumber: number;
};

type AttendeeTest = Assert<Equal<AttendeeResult, AttendeeExpected>>;

// Test 5: Union narrowing with $in operator
type InUnionQuery = {
  type: { $in: ["speaker"] };
};

type InUnionResult = ResolveMatchOutput<Person, InUnionQuery>;

type InUnionExpected = {
  type: "speaker";
  name: string;
  topic: string;
};

type InUnionTest = Assert<Equal<InUnionResult, InUnionExpected>>;

// Test 6: Complex union with multiple discriminators
type Vehicle =
  | {
      vehicleType: "car";
      wheels: 4;
      doors: number;
    }
  | {
      vehicleType: "bike";
      wheels: 2;
      hasPedals: boolean;
    }
  | {
      vehicleType: "truck";
      wheels: number;
      capacity: number;
    };

type CarQuery = {
  vehicleType: "car";
};

type CarResult = ResolveMatchOutput<Vehicle, CarQuery>;

type CarExpected = {
  vehicleType: "car";
  wheels: 4;
  doors: number;
};

type CarTest = Assert<Equal<CarResult, CarExpected>>;

// ============================================================================
// Comparison Operators
// ============================================================================

// Test 7: Greater than operator
type ComparisonSchema = {
  age: number;
  name: string;
};

type GtQuery = {
  age: { $gt: 18 };
};

type GtResult = ResolveMatchOutput<ComparisonSchema, GtQuery>;

type GtExpected = {
  age: number;
  name: string;
};

type GtTest = Assert<Equal<GtResult, GtExpected>>;

// Test 8: Less than or equal operator
type LteQuery = {
  age: { $lte: 65 };
};

type LteResult = ResolveMatchOutput<ComparisonSchema, LteQuery>;

type LteExpected = {
  age: number;
  name: string;
};

type LteTest = Assert<Equal<LteResult, LteExpected>>;

// ============================================================================
// Existence Operators
// ============================================================================

// Test 9: Field existence check
type OptionalFieldSchema = {
  required: string;
  optional?: number;
};

type ExistsQuery = {
  optional: { $exists: true };
};

type ExistsResult = ResolveMatchOutput<OptionalFieldSchema, ExistsQuery>;

type ExistsExpected = {
  required: string;
  optional?: number;
};

type ExistsTest = Assert<Equal<ExistsResult, ExistsExpected>>;

// ============================================================================
// Array Operators
// ============================================================================

// Test 10: Array size operator
type ArraySchema = {
  tags: string[];
  count: number;
};

type SizeQuery = {
  tags: { $size: 3 };
};

type SizeResult = ResolveMatchOutput<ArraySchema, SizeQuery>;

type SizeExpected = {
  tags: string[];
  count: number;
};

type SizeTest = Assert<Equal<SizeResult, SizeExpected>>;

// ============================================================================
// Nested Field Matching
// ============================================================================

// Test 11: Dotted field notation
type NestedSchema = {
  user: {
    profile: {
      age: number;
      name: string;
    };
  };
};

type NestedQuery = {
  "user.profile.age": { $gte: 21 };
};

type NestedResult = ResolveMatchOutput<NestedSchema, NestedQuery>;

type NestedExpected = {
  user: {
    profile: {
      age: number;
      name: string;
    };
  };
};

type NestedTest = Assert<Equal<NestedResult, NestedExpected>>;

// Test 12: Array index notation
type ArrayIndexSchema = {
  items: { id: number; name: string }[];
};

type ArrayIndexQuery = {
  "items.0.id": 1;
};

type ArrayIndexResult = ResolveMatchOutput<ArrayIndexSchema, ArrayIndexQuery>;

type ArrayIndexExpected = {
  items: { id: number; name: string }[];
};

type ArrayIndexTest = Assert<Equal<ArrayIndexResult, ArrayIndexExpected>>;

// ============================================================================
// Logical Operators
// ============================================================================

// Test 13: $and operator (currently preserves schema)
type AndQuery = {
  $and: [{ type: "speaker" }, { name: "Alice" }];
};

type AndResult = ResolveMatchOutput<Person, AndQuery>;

// Currently $and doesn't narrow - preserves full schema
type AndExpected = Person;

type AndTest = Assert<Equal<AndResult, AndExpected>>;

// Test 14: $or operator (currently preserves schema)
type OrQuery = {
  $or: [{ type: "speaker" }, { type: "attendee" }];
};

type OrResult = ResolveMatchOutput<Person, OrQuery>;

// Currently $or doesn't narrow - preserves full schema
type OrExpected = Person;

type OrTest = Assert<Equal<OrResult, OrExpected>>;

// ============================================================================
// Complex Union Narrowing
// ============================================================================

// Test 15: Multi-level union with nested objects
type Event =
  | {
      eventType: "conference";
      details: {
        speakers: string[];
        venue: string;
      };
    }
  | {
      eventType: "workshop";
      details: {
        instructor: string;
        capacity: number;
      };
    }
  | {
      eventType: "meetup";
      details: {
        host: string;
        casual: true;
      };
    };

type ConferenceQuery = {
  eventType: "conference";
};

type ConferenceResult = ResolveMatchOutput<Event, ConferenceQuery>;

type ConferenceExpected = {
  eventType: "conference";
  details: {
    speakers: string[];
    venue: string;
  };
};

type ConferenceTest = Assert<Equal<ConferenceResult, ConferenceExpected>>;

// Test 16: Union narrowing with nested field match
type NestedUnionQuery = {
  "details.casual": true;
};

type NestedUnionResult = ResolveMatchOutput<Event, NestedUnionQuery>;

type NestedUnionExpected = {
  eventType: "meetup";
  details: {
    host: string;
    casual: true;
  };
};

type NestedUnionTest = Assert<Equal<NestedUnionResult, NestedUnionExpected>>;

// Test 17: Multiple field narrowing
type Product =
  | {
      category: "electronics";
      warranty: number;
      voltage: number;
    }
  | {
      category: "clothing";
      size: string;
      material: string;
    }
  | {
      category: "food";
      expiryDate: Date;
      perishable: true;
    };

type ElectronicsQuery = {
  category: "electronics";
  warranty: { $gte: 1 };
};

type ElectronicsResult = ResolveMatchOutput<Product, ElectronicsQuery>;

type ElectronicsExpected = {
  category: "electronics";
  warranty: number;
  voltage: number;
};

type ElectronicsTest = Assert<Equal<ElectronicsResult, ElectronicsExpected>>;

// Satisfy linting by exporting all test types
export type {
  SimpleEqualityTest,
  ExplicitEqTest,
  SpeakerTest,
  AttendeeTest,
  InUnionTest,
  CarTest,
  GtTest,
  LteTest,
  ExistsTest,
  SizeTest,
  NestedTest,
  ArrayIndexTest,
  AndTest,
  OrTest,
  ConferenceTest,
  NestedUnionTest,
  ElectronicsTest,
};

// ============================================================================
// Prettify wrapping on ResolveMatchOutput
// ============================================================================
// Verifies that a multi-key match query against a multi-key schema resolves to
// a flat object shape (no nested intersection chains in hover).

type PrettifyMatchSchema = {
  a: number;
  b: string;
  c: boolean;
  d: { nested: number };
};
type PrettifyMatchQuery = { a: 1; b: "x" };
type PrettifyMatchResult = ResolveMatchOutput<
  PrettifyMatchSchema,
  PrettifyMatchQuery
>;
type PrettifyMatchExpected = {
  a: number;
  b: string;
  c: boolean;
  d: { nested: number };
};
type PrettifyMatchTest = Assert<
  Equal<PrettifyMatchResult, PrettifyMatchExpected>
>;

export type { PrettifyMatchTest };

// ============================================================================
// Typed operator errors
// ============================================================================
// `ComparatorMatchers<T>` now returns `PipeSafeError` in operand slot positions
// when the operator is incompatible with the field type. The literal message
// surfaces in IDE hovers when a user assigns the wrong operand type.

// $gte on string[] — incompatible (numeric/date only). Operand type must be
// a `PipeSafeError` whose message names the operator and the field type.
type GteOnStringArrayOperand = NonNullable<
  ComparatorMatchers<string[]>["$gte"]
>;
type _GteOnStringArrayMsg = Assert<
  AssertPipeSafeError<
    GteOnStringArrayOperand,
    "Operator '$gte' requires a numeric or date field."
  >
>;

// $gte on Date — compatible. Operand type must be Date (positive case).
type GteOnDateOperand = NonNullable<ComparatorMatchers<Date>["$gte"]>;
type _GteOnDateValid = Assert<Equal<GteOnDateOperand, Date>>;

// $gte on number — compatible. Operand type must be number (positive case).
type GteOnNumberOperand = NonNullable<ComparatorMatchers<number>["$gte"]>;
type _GteOnNumberValid = Assert<Equal<GteOnNumberOperand, number>>;

// $regex on number — incompatible (string only).
type RegexOnNumberOperand = NonNullable<ComparatorMatchers<number>["$regex"]>;
type _RegexOnNumberMsg = Assert<
  AssertPipeSafeError<
    RegexOnNumberOperand,
    "Operator '$regex' requires a string field."
  >
>;

// $regex on string — compatible. Operand may be RegExp or string.
type RegexOnStringOperand = NonNullable<ComparatorMatchers<string>["$regex"]>;
type _RegexOnStringValid = Assert<Equal<RegexOnStringOperand, RegExp | string>>;

// $size on string — incompatible (array only).
type SizeOnStringOperand = NonNullable<ComparatorMatchers<string>["$size"]>;
type _SizeOnStringMsg = Assert<
  AssertPipeSafeError<
    SizeOnStringOperand,
    "Operator '$size' requires an array field."
  >
>;

// $size on string[] — compatible. Operand is number.
type SizeOnArrayOperand = NonNullable<ComparatorMatchers<string[]>["$size"]>;
type _SizeOnArrayValid = Assert<Equal<SizeOnArrayOperand, number>>;

// $all on string — incompatible.
type AllOnStringOperand = NonNullable<ComparatorMatchers<string>["$all"]>;
type _AllOnStringMsg = Assert<
  AssertPipeSafeError<
    AllOnStringOperand,
    "Operator '$all' requires an array field."
  >
>;

// $all on string[] — compatible. Operand is string[].
type AllOnArrayOperand = NonNullable<ComparatorMatchers<string[]>["$all"]>;
type _AllOnArrayValid = Assert<Equal<AllOnArrayOperand, string[]>>;

// $elemMatch on number — incompatible.
type ElemMatchOnNumberOperand = NonNullable<
  ComparatorMatchers<number>["$elemMatch"]
>;
type _ElemMatchOnNumberMsg = Assert<
  AssertPipeSafeError<
    ElemMatchOnNumberOperand,
    "Operator '$elemMatch' requires an array field."
  >
>;

// $elemMatch on number[] — compatible. The operand is now a match query
// against the ELEMENT type (comparators + Notted), not the bare element type.
type ElemMatchOnArrayOperand = NonNullable<
  ComparatorMatchers<number[]>["$elemMatch"]
>;
type _ElemMatchOnArrayValid = Assert<
  Equal<
    ElemMatchOnArrayOperand,
    ComparatorMatchers<number> | Notted<ComparatorMatchers<number>>
  >
>;
// An element-level comparator (`{ $gte: 80 }`) is accepted...
type _ElemMatchOnArrayAccepts = Assert<
  IsAssignable<{ $gte: 80 }, ElemMatchOnArrayOperand>
>;
// ...but a wrong-typed operand for a known operator is not (an unknown element
// key is rejected at the value position by excess-property checking, exercised
// by the completions suite).
type _ElemMatchOnArrayRejectsBadValue = Assert<
  Equal<IsAssignable<{ $gte: "nope" }, ElemMatchOnArrayOperand>, false>
>;

// ---------------------------------------------------------------------------
// Runtime array ↔ matcher-key lockstep: the exported operator lists are the
// source the matcher-key unions derive from, but $exists/$type keep literal
// keys in ComparatorMatchers (their value types differ) and $not lives in
// the Notted wrapper — these pins make any drift between the spread
// combinations and the actual query surface a compile failure.
// ---------------------------------------------------------------------------

type _FieldMatchOperatorsListed = Assert<
  Equal<
    (typeof FIELD_MATCH_OPERATORS)[number],
    keyof ComparatorMatchers<unknown> | "$not"
  >
>;
type _TopLevelMatchOperatorsListed = Assert<
  Equal<
    (typeof TOP_LEVEL_MATCH_OPERATORS)[number],
    LogicalMatchOperators | "$expr"
  >
>;

export type {
  _FieldMatchOperatorsListed,
  _TopLevelMatchOperatorsListed,
  _GteOnStringArrayMsg,
  _GteOnDateValid,
  _GteOnNumberValid,
  _RegexOnNumberMsg,
  _RegexOnStringValid,
  _SizeOnStringMsg,
  _SizeOnArrayValid,
  _AllOnStringMsg,
  _AllOnArrayValid,
  _ElemMatchOnNumberMsg,
  _ElemMatchOnArrayValid,
  _ElemMatchOnArrayAccepts,
  _ElemMatchOnArrayRejectsBadValue,
};
