import { Assert, Equal } from "../utils/tests";
import { ResolveCountOutput } from "./count";

// ============================================================================
// $count Output Type
// ============================================================================

// Test 1: Single literal field name produces a record with that field
type TotalCountOutput = ResolveCountOutput<"total">;
type TotalCountExpected = { total: number };
type TotalCountTest = Assert<Equal<TotalCountOutput, TotalCountExpected>>;

// Test 2: A different literal field name produces a different shape
type CustomCountOutput = ResolveCountOutput<"docCount">;
type CustomCountExpected = { docCount: number };
type CustomCountTest = Assert<Equal<CustomCountOutput, CustomCountExpected>>;

// Test 3: Field name with dashes/underscores still produces a single-key record
type SnakeCaseOutput = ResolveCountOutput<"my_count">;
type SnakeCaseExpected = { my_count: number };
type SnakeCaseTest = Assert<Equal<SnakeCaseOutput, SnakeCaseExpected>>;

export type { TotalCountTest, CustomCountTest, SnakeCaseTest };
