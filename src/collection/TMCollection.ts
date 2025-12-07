import { MongoClient } from "mongodb";
import { TMPipeline } from "../pipeline/TMPipeline";
import { Document } from "../utils/core";

export class TMCollection<Docs extends Document> {
  private client: MongoClient | undefined;
  private databaseName: string | undefined;
  private collectionName: string;
  constructor(args: {
    client?: MongoClient | undefined;
    databaseName?: string | undefined;
    collectionName: string;
  }) {
    this.client = args.client;
    this.databaseName = args.databaseName;
    this.collectionName = args.collectionName;
  }

  getCollectionName(): string {
    return this.collectionName;
  }

  aggregate(): TMPipeline<Docs, Docs> {
    return new TMPipeline<Docs, Docs>({
      client: this.client,
      databaseName: this.databaseName,
      collectionName: this.collectionName,
    });
  }
}

export type InferCollectionType<Collection extends TMCollection<any>> =
  Collection extends TMCollection<infer Docs> ? Docs : never;
