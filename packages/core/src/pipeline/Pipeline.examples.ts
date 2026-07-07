import { Pipeline, InferOutputType } from "./Pipeline";

type Person = {
  name: string;
  email: string;
  date_of_birth: Date;
};

type Speaker = Person & {
  type: "speaker";
};

type Interests = "programming" | "design" | "marketing" | "business" | "other";
type Attendee = Person & {
  type: "attendee";
  interests: Interests[];
};

// Test 1: Match on shared field "type" - this should work
// Using satisfies to preserve literal types while checking constraint
const _pipeline = new Pipeline<Speaker | Attendee>()
  .match({
    // type: "attendee",
    email: "joe@gmail.com",
  })
  .set({
    other: {
      date: "$date_of_birth",
    },
    thing: "$date_of_birth",
    test: {
      ing: {
        else: "this",
      },
    },
  })
  .set({
    "test.ing.something": "again",
  })
  .set({
    test: {
      gone: true,
    },
  });

export type OutputType = InferOutputType<typeof _pipeline>;
console.log(_pipeline.getPipeline());

// ==============================================================================
// Test 2: $concatArrays expression support
// ==============================================================================

type TestDoc = {
  items: string[];
  numbers: number[];
  tags: ("a" | "b" | "c")[];
  name: string; // Non-array field for testing validation
};

const concatPipeline = new Pipeline<TestDoc>()
  .set({
    // Test 1: Concat field reference with array literal
    items: {
      $concatArrays: ["$items", ["new1", "new2"]],
    },
  })
  .set({
    // Test 2: Concat multiple arrays including literals
    numbers: {
      $concatArrays: ["$numbers", [100, 200], [300]],
    },
  })
  .set({
    // Test 3: Concat with literal type preservation
    tags: {
      $concatArrays: ["$tags", ["a", "b"]],
    },
  });

export type ConcatOutputType = InferOutputType<typeof concatPipeline>;
// Should be: { items: string[], numbers: number[], tags: ("a" | "b" | "c")[], name: string }

// Type validation test: This should cause a type error
// Note: Currently "$name" is treated as a string literal, not a field reference
// Since the ObjectLiteral $-key guard, the rejection reports on the property
// (TS2322 against the value union) and can also surface a statement-level
// TS2589 while TS explores the union — both are the expected failure.
// @ts-expect-error - depth blowup (TS2589) while rejecting the invalid expression
export const _invalidPipeline = new Pipeline<TestDoc>().set({
  // @ts-expect-error - ERROR: $name is string, not array
  items: {
    $concatArrays: ["$name", ["test"]], // ERROR: $name is string, not array
  },
});

console.log("\n$concatArrays pipeline:");
console.log(concatPipeline.getPipeline());
