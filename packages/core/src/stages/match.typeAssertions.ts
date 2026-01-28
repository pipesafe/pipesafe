import { Assert, Equal } from "../utils/tests";
import { ResolveMatchOutput } from "./match";

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
  SimpleEqualityQuery,
  SimpleEqualitySchema
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

type ExplicitEqResult = ResolveMatchOutput<ExplicitEqQuery, ExplicitEqSchema>;

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

type SpeakerResult = ResolveMatchOutput<SpeakerQuery, Person>;

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

type AttendeeResult = ResolveMatchOutput<AttendeeQuery, Person>;

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

type InUnionResult = ResolveMatchOutput<InUnionQuery, Person>;

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

type CarResult = ResolveMatchOutput<CarQuery, Vehicle>;

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

type GtResult = ResolveMatchOutput<GtQuery, ComparisonSchema>;

type GtExpected = {
  age: number;
  name: string;
};

type GtTest = Assert<Equal<GtResult, GtExpected>>;

// Test 8: Less than or equal operator
type LteQuery = {
  age: { $lte: 65 };
};

type LteResult = ResolveMatchOutput<LteQuery, ComparisonSchema>;

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

type ExistsResult = ResolveMatchOutput<ExistsQuery, OptionalFieldSchema>;

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

type SizeResult = ResolveMatchOutput<SizeQuery, ArraySchema>;

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

type NestedResult = ResolveMatchOutput<NestedQuery, NestedSchema>;

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

type ArrayIndexResult = ResolveMatchOutput<ArrayIndexQuery, ArrayIndexSchema>;

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

type AndResult = ResolveMatchOutput<AndQuery, Person>;

// Currently $and doesn't narrow - preserves full schema
type AndExpected = Person;

type AndTest = Assert<Equal<AndResult, AndExpected>>;

// Test 14: $or operator (currently preserves schema)
type OrQuery = {
  $or: [{ type: "speaker" }, { type: "attendee" }];
};

type OrResult = ResolveMatchOutput<OrQuery, Person>;

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

type ConferenceResult = ResolveMatchOutput<ConferenceQuery, Event>;

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

type NestedUnionResult = ResolveMatchOutput<NestedUnionQuery, Event>;

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

type ElectronicsResult = ResolveMatchOutput<ElectronicsQuery, Product>;

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
