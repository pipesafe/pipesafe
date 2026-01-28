# @pipesafe/core

**PipeSafe Core** - A fully type-safe MongoDB aggregation pipeline builder for TypeScript projects.

[![npm version](https://img.shields.io/npm/v/@pipesafe/core.svg)](https://www.npmjs.com/package/@pipesafe/core)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Installation

```bash
npm install @pipesafe/core
```

## Purpose

PipeSafe provides compile-time type safety for MongoDB aggregation pipelines, ensuring that:

- Field references are validated against your document schemas
- Pipeline stage outputs are correctly inferred through each transformation
- Type errors are caught at development time, not runtime

## Quick Example

```typescript
import { Pipeline, InferOutputType } from "@pipesafe/core";

type User = {
  userId: string;
  email: string;
  profile: {
    firstName: string;
    lastName: string;
  };
  metadata: {
    isActive: boolean;
  };
};

const pipeline = new Pipeline<User>()
  .match({
    "metadata.isActive": true, // Type-checked field paths
  })
  .project({
    userId: 1,
    email: 1,
    firstName: "$profile.firstName",
    lastName: "$profile.lastName",
  });

type Output = InferOutputType<typeof pipeline>;
// Output is correctly inferred: { userId: string; email: string; firstName: string; lastName: string; }

// Get the MongoDB aggregation pipeline JSON
const pipelineJson = pipeline.getPipeline();
// Returns: [{ $match: { "metadata.isActive": true } }, { $project: { userId: 1, email: 1, firstName: "$profile.firstName", lastName: "$profile.lastName" } }]
```

## Features

- **Type-safe field references** - Field paths are validated against your document types
- **Automatic output inference** - Each pipeline stage correctly types its output
- **Flexible connection patterns** - Three connection patterns (Singleton, Chained, On Execution) to suit different use cases
- **Supported stages** - `match`, `project`, `set`, `unset`, `group`, `lookup`, `replaceRoot`, `unionWith`, `sort`, `limit`, `skip`, `unwind`, `out`
- **Expression operators** - Supports `$concatArrays`, `$size`, `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`, `$dateToString`, `$concat` (more coming soon)
- **Collection-aware lookups** - Type-safe joins with automatic type inference
- **Full TypeScript support** - Leverages TypeScript's type system for maximum safety

## Connections

PipeSafe supports three flexible connection patterns, each offering different advantages and use cases. The **Singleton Pattern** is most similar to Mongoose's `mongoose.connect()` approach.

### Pattern 1: Singleton Pattern (Similar to Mongoose)

Connect once using `pipesafe.connect(uri)` and access databases/collections through the singleton instance.

```typescript
import { pipesafe, Collection } from "@pipesafe/core";

// Connect once at application startup
pipesafe.connect("mongodb://localhost:27017");

// Access databases and collections
const collection = pipesafe
  .db("my_database")
  .collection<{ test: string }>("my_collection");

// Execute aggregation - automatically uses singleton client
const cursor = await collection.aggregate().execute();
const results = await cursor.toArray();

// Collections without explicit client also use singleton
const anotherCollection = new Collection<{ test: string }>({
  collectionName: "my_collection",
});
const cursor2 = await anotherCollection.aggregate().execute();
```

### Pattern 2: Chained Pattern

Create `Database` or `Collection` instances directly with a client.

```typescript
import { MongoClient } from "mongodb";
import { Database, Collection } from "@pipesafe/core";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

// Option A: Start from Database
const db = new Database({
  client,
  databaseName: "my_database",
});
const collection = db.collection<{ test: string }>("my_collection");
const cursor = await collection.aggregate().execute();
const results = await cursor.toArray();

// Option B: Start from Collection
const collection2 = new Collection<{ test: string }>({
  client,
  collectionName: "my_collection",
});
const cursor2 = await collection2.aggregate().execute();
const results2 = await cursor2.toArray();
```

### Pattern 3: On Execution Pattern

Pass the client directly to the `execute()` method.

```typescript
import { MongoClient } from "mongodb";
import { Collection, Pipeline } from "@pipesafe/core";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

// Option A: Collection with client passed to execute()
const collection = new Collection<{ test: string }>({
  collectionName: "my_collection",
});
const cursor = await collection.aggregate().execute({
  client,
  databaseName: "my_database",
});
const results = await cursor.toArray();

// Option B: Pipeline executed directly with client
const pipeline = new Pipeline<{ test: string }>();
const cursor2 = await pipeline.execute({
  client,
  databaseName: "my_database",
  collectionName: "my_collection",
});
const results2 = await cursor2.toArray();
```

## Collection Commands

`Collection` provides type-safe passthrough methods to all standard MongoDB collection operations:

```typescript
import { pipesafe } from "@pipesafe/core";

pipesafe.connect("mongodb://localhost:27017");

type User = {
  _id: ObjectId;
  name: string;
  email: string;
  age: number;
};

const users = pipesafe.db("mydb").collection<User>("users");

// Query
const cursor = users.find({ age: { $gte: 18 } });
const user = await users.findOne({ email: "test@example.com" });

// Insert
await users.insertOne({ name: "Alice", email: "alice@example.com", age: 30 });
await users.insertMany([
  { name: "Bob", email: "bob@example.com", age: 25 },
  { name: "Charlie", email: "charlie@example.com", age: 35 },
]);

// Update
await users.updateOne({ email: "alice@example.com" }, { $set: { age: 31 } });
await users.updateMany({ age: { $lt: 18 } }, { $set: { status: "minor" } });

// Delete
await users.deleteOne({ email: "old@example.com" });
await users.deleteMany({ status: "inactive" });

// Find and Modify (atomic operations)
const updated = await users.findOneAndUpdate(
  { email: "alice@example.com" },
  { $inc: { age: 1 } },
  { returnDocument: "after" }
);

// Count and Distinct
const count = await users.countDocuments({ age: { $gte: 18 } });
const emails = await users.distinct("email");

// Index Management
await users.createIndex({ email: 1 }, { unique: true });
await users.createIndexes([{ key: { name: 1 } }, { key: { age: -1 } }]);
const indexes = await users.indexes();

// Bulk Operations
await users.bulkWrite([
  {
    insertOne: { document: { name: "New", email: "new@example.com", age: 20 } },
  },
  { updateOne: { filter: { name: "Bob" }, update: { $set: { age: 26 } } } },
  { deleteOne: { filter: { name: "Charlie" } } },
]);
```

## DAG Orchestration

For DAG model composition and orchestration features (Model, Project), see the companion package [`@pipesafe/manifold`](https://www.npmjs.com/package/@pipesafe/manifold).

## Status

PipeSafe is actively under development. Contributions, feedback, and suggestions are welcome!

## License

[Apache License 2.0](https://opensource.org/licenses/Apache-2.0)
