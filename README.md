# tmql

**Typed Mongo Query Language** - A fully type-safe MongoDB aggregation pipeline builder for TypeScript projects.

## Purpose

tmql provides compile-time type safety for MongoDB aggregation pipelines, ensuring that:

- Field references are validated against your document schemas
- Pipeline stage outputs are correctly inferred through each transformation
- Type errors are caught at development time, not runtime

## Quick Example

```typescript
import { TMPipeline, InferOutputType } from "tmql";

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

const pipeline = new TMPipeline<User>()
  .match({
    "metadata.isActive": true, // ✅ Type-checked field paths
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
- **Supported stages** - `match`, `project`, `set`, `unset`, `group`, `lookup`, `replaceRoot`, `unionWith`, `out`
- **Expression operators** - Supports `$concatArrays`, `$size`, `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`, `$dateToString` (more coming soon)
- **Collection-aware lookups** - Type-safe joins with automatic type inference
- **Full TypeScript support** - Leverages TypeScript's type system for maximum safety

## Connections

tmql supports three flexible connection patterns, each offering different advantages and use cases. The **Singleton Pattern** is most similar to Mongoose's `mongoose.connect()` approach, making it familiar for developers coming from Mongoose.

> **Note:** We intend to make the types stricter for each option so that errors are specific to the connection pattern in use.

### Pattern 1: Singleton Pattern (Similar to Mongoose)

Connect once using `tmql.connect(uri)` and access databases/collections through the singleton instance. This pattern is ideal for applications with a single database connection.

**Advantages:**

- Simple and familiar to Mongoose users
- Less boilerplate - connect once, use everywhere
- Ideal for applications with a single database connection
- Collections created without explicit client automatically use singleton connection

```typescript
import { tmql, TMCollection } from "tmql";

// Connect once at application startup
tmql.connect("mongodb://localhost:27017");

// Access databases and collections
const collection = tmql
  .db("my_database")
  .collection<{ test: string }>("my_collection");

// Execute aggregation - automatically uses singleton client
const cursor = await collection.aggregate().execute();
const results = await cursor.toArray();

// Collections without explicit client also use singleton
const anotherCollection = new TMCollection<{ test: string }>({
  collectionName: "my_collection",
});
const cursor2 = await anotherCollection.aggregate().execute();
```

### Pattern 2: Chained Pattern

Create `TMDatabase` or `TMCollection` instances directly with a client. This pattern provides explicit connection management and is better suited for multi-database scenarios.

**Advantages:**

- Explicit connection management - you know exactly which client/database you're using
- Better for multi-database scenarios
- Dependency injection friendly - easy to pass mock clients for testing
- More testable - each instance has its own connection context

```typescript
import { MongoClient } from "mongodb";
import { TMDatabase, TMCollection } from "tmql";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

// Option A: Start from TMDatabase
const db = new TMDatabase({
  client,
  databaseName: "my_database",
});
const collection = db.collection<{ test: string }>("my_collection");
const cursor = await collection.aggregate().execute();
const results = await cursor.toArray();

// Option B: Start from TMCollection
const collection2 = new TMCollection<{ test: string }>({
  client,
  collectionName: "my_collection",
});
const cursor2 = await collection2.aggregate().execute();
const results2 = await cursor2.toArray();
```

### Pattern 3: On Execution Pattern

Pass the client directly to the `execute()` method. This provides maximum flexibility for ad-hoc queries or when you need to override the connection per query.

**Advantages:**

- Maximum flexibility - can override connection per query
- Useful for ad-hoc queries or one-off operations
- Allows using different connections for different operations
- Good for testing individual queries without setting up full connection context

```typescript
import { MongoClient } from "mongodb";
import { TMCollection, TMPipeline } from "tmql";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

// Option A: TMCollection with client passed to execute()
const collection = new TMCollection<{ test: string }>({
  collectionName: "my_collection",
});
const cursor = await collection.aggregate().execute({
  client,
  databaseName: "my_database",
});
const results = await cursor.toArray();

// Option B: TMPipeline executed directly with client
const pipeline = new TMPipeline<{ test: string }>();
const cursor2 = await pipeline.execute({
  client,
  databaseName: "my_database",
  collectionName: "my_collection",
});
const results2 = await cursor2.toArray();
```

## Collection Commands

`TMCollection` provides type-safe passthrough methods to all standard MongoDB collection operations:

```typescript
import { tmql } from "tmql";

tmql.connect("mongodb://localhost:27017");

type User = {
  _id: ObjectId;
  name: string;
  email: string;
  age: number;
};

const users = tmql.db("mydb").collection<User>("users");

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

All methods use MongoDB driver types for parameters and return values, providing full type safety while maintaining familiar MongoDB semantics.

## DAG Model Composition

tmql supports composing pipelines into a Directed Acyclic Graph (DAG) with typed dependencies and configurable materialization strategies, inspired by dbt's approach but tailored for MongoDB.

### Defining Models

Models are standalone pipeline definitions with typed input/output:

```typescript
import { TMCollection, TMModel, TMProject } from "tmql";

// Source collection
const RawEventsCollection = new TMCollection<RawEvent>({
  collectionName: "raw_events",
});

// Staging model - filters and transforms raw data
const stgEvents = new TMModel({
  name: "stg_events",
  from: RawEventsCollection,
  pipeline: (p) =>
    p
      .match({ _deleted: { $ne: true } })
      .set({ eventDate: { $dateTrunc: { date: "$timestamp", unit: "day" } } }),
  materialize: { type: "collection", mode: TMModel.Mode.Replace },
});

// Downstream model - depends on stgEvents (type-safe!)
const dailyMetrics = new TMModel({
  name: "daily_metrics",
  from: stgEvents,
  pipeline: (p) =>
    p.group({
      _id: "$eventDate",
      totalEvents: { $count: {} },
      uniqueUsers: { $addToSet: "$userId" },
    }),
  materialize: { type: "collection", mode: TMModel.Mode.Upsert },
});
```

### Creating a Project

Projects orchestrate model execution with automatic dependency discovery. Just specify your leaf models - all upstream dependencies (via `from`) and lookup dependencies (via `lookup`/`unionWith`) are automatically included:

```typescript
const analyticsProject = new TMProject({
  name: "analytics",
  // Only specify leaf models - stgEvents is auto-discovered as a dependency
  models: [dailyMetrics],
});

// View execution plan
console.log(analyticsProject.plan().toString());
// Stage 1: stg_events
// Stage 2: daily_metrics

// View as Mermaid diagram
console.log(analyticsProject.toMermaid());

// Run all models in dependency order
await analyticsProject.run({
  client: mongoClient,
  databaseName: "analytics_db",
});
```

### Materialization Strategies

- **view** - Creates a MongoDB view
- **collection** with preset modes:
  - `TMModel.Mode.Replace` - Replace entire collection using `$out`
  - `TMModel.Mode.Upsert` - Upsert by `_id` using `$merge`
  - `TMModel.Mode.Append` - Insert only, fail on match
  - `{ $merge: { on, whenMatched, whenNotMatched } }` - Custom merge options

## Status

tmql is actively under development. We're continuously working on improving type safety, adding new features, and enhancing the developer experience. Contributions, feedback, and suggestions are welcome!
