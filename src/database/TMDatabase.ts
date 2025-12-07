import { MongoClient } from "mongodb";
import { Document } from "../utils/core";
import { TMCollection } from "../collection/TMCollection";

export class TMDatabase {
  private client: MongoClient | undefined;
  private databaseName: string;
  constructor(args: {
    client?: MongoClient | undefined;
    databaseName: string;
  }) {
    this.client = args.client;
    this.databaseName = args.databaseName;
  }

  getDatabaseName(): string {
    return this.databaseName;
  }

  collection<Schema extends Document>(
    collectionName: string
  ): TMCollection<Schema> {
    return new TMCollection<Schema>({
      client: this.client,
      databaseName: this.databaseName,
      collectionName,
    });
  }
}
