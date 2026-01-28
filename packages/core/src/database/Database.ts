import {
  MongoClient,
  ListCollectionsOptions,
  CreateCollectionOptions,
  DropCollectionOptions,
  RenameOptions,
  DbStatsOptions,
  RunCommandOptions,
} from "mongodb";
import { Document } from "../utils/core";
import { Collection } from "../collection/Collection";
import { pipesafe } from "../singleton/pipesafe";

export class Database {
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
  ): Collection<Schema> {
    return new Collection<Schema>({
      client: this.client,
      databaseName: this.databaseName,
      collectionName,
    });
  }

  // Private helpers

  private getClient() {
    const client = this.client ?? pipesafe.client;
    if (!client) {
      throw new Error(
        "No client available. Either pass a client to Database or connect via pipesafe.connect()"
      );
    }
    return client;
  }

  private getDatabase() {
    const client = this.getClient();
    return client.db(this.databaseName);
  }

  // Collection Management

  listCollections(filter?: Document, options?: ListCollectionsOptions) {
    return this.getDatabase().listCollections(filter, options);
  }

  async createCollection<Schema extends Document>(
    name: string,
    options?: CreateCollectionOptions
  ) {
    return this.getDatabase().createCollection<Schema>(name, options);
  }

  async dropCollection(name: string, options?: DropCollectionOptions) {
    return this.getDatabase().dropCollection(name, options);
  }

  async renameCollection(
    fromCollection: string,
    toCollection: string,
    options?: RenameOptions
  ) {
    return this.getDatabase().renameCollection(
      fromCollection,
      toCollection,
      options
    );
  }

  // Database Information

  async stats(options?: DbStatsOptions) {
    return this.getDatabase().stats(options);
  }

  async command(command: Document, options?: RunCommandOptions) {
    return this.getDatabase().command(command, options);
  }
}
