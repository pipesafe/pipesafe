/**
 * Test script for $ifNull and $cond expressions using local MongoDB
 *
 * Run with: bun run tsx .claude/test-conditional-expressions.ts
 */

import { setupLocalMongo } from "./local-mongodb";

type TestDoc = {
  _id: string;
  name?: string;
  email: string;
  age?: number;
  status: string;
  preferredName?: string;
};

async function main() {
  const mongo = await setupLocalMongo();

  try {
    // Clear existing data and seed test data with optional/missing fields
    await mongo.collection.deleteMany({});

    console.log("\n📊 Seeding test data...");
    const testData: any[] = [
      {
        _id: "1",
        name: "Alice",
        email: "alice@example.com",
        age: 30,
        status: "active",
        preferredName: "Al",
      },
      {
        _id: "2",
        email: "bob@example.com",
        age: 25,
        status: "active",
        // name is missing
      },
      {
        _id: "3",
        name: "Charlie",
        email: "charlie@example.com",
        // age is missing
        status: "inactive",
      },
      {
        _id: "4",
        name: "Diana",
        email: "diana@example.com",
        age: 28,
        status: "pending",
        preferredName: undefined, // explicitly undefined
      },
    ];

    const insertResult = await mongo.collection.insertMany(testData);
    console.log(`✅ Inserted ${insertResult.insertedCount} documents\n`);

    // Verify data was inserted
    const count = await mongo.collection.countDocuments();
    console.log(`📊 Total documents in collection: ${count}\n`);

    // Test 0: Simple test to verify data is queryable
    console.log("=".repeat(60));
    console.log("Test 0: Simple test to verify data is queryable");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      { $sort: { _id: 1 } },
    ]);

    // Test 1: $ifNull with field reference and string default
    console.log("\n" + "=".repeat(60));
    console.log("Test 1: $ifNull with field reference and string default");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          displayName: { $ifNull: ["$name", "Anonymous"] },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 2: $ifNull with multiple null values then a field
    console.log("\n" + "=".repeat(60));
    console.log("Test 2: $ifNull with multiple nulls then field");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          statusFallback: { $ifNull: [null, null, "$status"] },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 3: $ifNull with field and numeric default
    console.log("\n" + "=".repeat(60));
    console.log("Test 3: $ifNull with field reference and numeric default");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          yearsOld: { $ifNull: ["$age", 18] },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 4: $ifNull with two field references
    console.log("\n" + "=".repeat(60));
    console.log("Test 4: $ifNull with two field references");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          nameOrPreferred: { $ifNull: ["$preferredName", "$name"] },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 5: $cond expression - simple boolean
    console.log("\n" + "=".repeat(60));
    console.log("Test 5: $cond with hardcoded boolean");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          userType: {
            $cond: [true, "verified", "unverified"],
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 6: $cond with $gte comparison (note: using as any to bypass compile-time checks)
    console.log("\n" + "=".repeat(60));
    console.log("Test 6: $cond comparing age >= 21");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      { $match: { age: { $exists: true } } },
      {
        $set: {
          ageCategory: {
            $cond: [
              { $gte: ["$age", 21] } as any,
              "adult",
              "underage",
            ],
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 7: $cond with $eq comparison
    console.log("\n" + "=".repeat(60));
    console.log("Test 7: $cond checking if status === 'active'");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      {
        $set: {
          isActive: {
            $cond: [
              { $eq: ["$status", "active"] } as any,
              1,
              0,
            ],
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Test 8: Nested $ifNull and $cond
    console.log("\n" + "=".repeat(60));
    console.log("Test 8: Nested $ifNull inside $cond");
    console.log("=".repeat(60));
    await mongo.testPipeline([
      { $match: { age: { $exists: true } } },
      {
        $set: {
          displayInfo: {
            $cond: [
              { $gte: ["$age", 18] } as any,
              { $ifNull: ["$name", "Anonymous Adult"] },
              { $ifNull: ["$name", "Anonymous Minor"] },
            ],
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongo.cleanup();
  }
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
