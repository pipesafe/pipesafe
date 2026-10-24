import {
  MongoClient,
  ListCollectionsOptions,
  CreateCollectionOptions,
  DropCollectionOptions,
  RenameOptions,
  DbStatsOptions,
  RunCommandOptions,
  CollectionOptions,
} from "mongodb";
import { Document } from "../utils/objects";
import { Collection } from "../collection/Collection";
import { pipesafe } from "../singleton/pipesafe";
import { tagClient } from "../singleton/tagClient";
import type { DbConfig } from "./config";

export class Database {
  private client: MongoClient | undefined;
  private db: DbConfig;
  constructor(args: { client?: MongoClient | undefined; db: DbConfig }) {
    this.client = args.client;
    this.db = args.db;
    tagClient(this.client);
  }

  getDatabaseName(): string {
    return this.db.name;
  }

  collection<Schema extends Document>(
    collectionName: string,
    options?: CollectionOptions
  ): Collection<Schema> {
    return new Collection<Schema>({
      client: this.client,
      db: this.db,
      collection: { name: collectionName, options },
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
    return client.db(this.db.name, this.db.options);
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
