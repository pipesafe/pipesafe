import { Assert, Equal } from "../utils/tests";
import { PipeSafeError } from "../utils/errors";
import { ResolveCountOutput } from "./count";

// ============================================================================
// $count Output Type
// ============================================================================

type SimpleSchema = { _id: string; value: number };

// Test 1: Single literal field name produces a record with that field
type TotalCountOutput = ResolveCountOutput<SimpleSchema, "total">;
type TotalCountExpected = { total: number };
type TotalCountTest = Assert<Equal<TotalCountOutput, TotalCountExpected>>;

// Test 2: A different literal field name produces a different shape
type CustomCountOutput = ResolveCountOutput<SimpleSchema, "docCount">;
type CustomCountExpected = { docCount: number };
type CustomCountTest = Assert<Equal<CustomCountOutput, CustomCountExpected>>;

// Test 3: Field name with dashes/underscores still produces a single-key record
type SnakeCaseOutput = ResolveCountOutput<SimpleSchema, "my_count">;
type SnakeCaseExpected = { my_count: number };
type SnakeCaseTest = Assert<Equal<SnakeCaseOutput, SnakeCaseExpected>>;

// Test 4: An upstream branded error is forwarded verbatim (PassThrough),
// not replaced by the count document.
type ErrSchema = PipeSafeError<"upstream">;
type ErrCountOutput = ResolveCountOutput<ErrSchema, "total">;
type ErrCountTest = Assert<Equal<ErrCountOutput, ErrSchema>>;

export type { TotalCountTest, CustomCountTest, SnakeCaseTest, ErrCountTest };
