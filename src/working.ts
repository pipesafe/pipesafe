import * as mongodb from "mongodb";
import { TMCollection } from "./collection/TMCollection";
import { tmql } from "./singleton/tmql";

type TestSchema = {
  name: string;
  age: number;
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
};

const client: mongodb.MongoClient = await new mongodb.MongoClient(
  "mongodb://localhost:27017",
  {}
).connect();

// Singleton manual execute
tmql.connect("mongodb://localhost:27017");
const aggregationQuery = new TMCollection<TestSchema>({
  collectionName: "test",
})
  .aggregate()
  .match({ name: "John" });

export const results1 = await aggregationQuery.execute();

// Singleton auto-execute
export const results2 = await new TMCollection<TestSchema>({
  collectionName: "test",
})
  .aggregate()
  .match({ name: "John" });

// No Singleton / override client
export const results3 = aggregationQuery.execute({
  client: client,
  databaseName: "test",
  collectionName: "test",
});
