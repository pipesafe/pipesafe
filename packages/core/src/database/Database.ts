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
import { CollectionInDatabase } from "../collection/CollectionInDatabase";
import { pipesafe } from "../singleton/pipesafe";
import { tagClient } from "../singleton/tagClient";
import type { DbConfig } from "./config";

export class Database<Db extends string = string> {
  private client: MongoClient | undefined;
  private db: DbConfig & { name: Db };
  constructor(args: {
    client?: MongoClient | undefined;
    db: DbConfig & { name: Db };
  }) {
    this.client = args.client;
    this.db = args.db;
    tagClient(this.client);
  }

  getDatabaseName(): Db {
    return this.db.name;
  }

  getDbConfig(): DbConfig & { name: Db } {
    return this.db;
  }

  /** @internal The explicitly passed client, if any */
  getMongoClient(): MongoClient | undefined {
    return this.client;
  }

  collection<Schema extends Document>(
    collectionName: string,
    options?: CollectionOptions
  ): CollectionInDatabase<Schema, Db> {
    return new CollectionInDatabase<Schema, Db>(this, {
      name: collectionName,
      options,
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

  /** @internal */
  getDriverDb() {
    const client = this.getClient();
    return client.db(this.db.name, this.db.options);
  }

  // Collection Management

  listCollections(filter?: Document, options?: ListCollectionsOptions) {
    return this.getDriverDb().listCollections(filter, options);
  }

  async createCollection<Schema extends Document>(
    name: string,
    options?: CreateCollectionOptions
  ) {
    return this.getDriverDb().createCollection<Schema>(name, options);
  }

  async dropCollection(name: string, options?: DropCollectionOptions) {
    return this.getDriverDb().dropCollection(name, options);
  }

  async renameCollection(
    fromCollection: string,
    toCollection: string,
    options?: RenameOptions
  ) {
    return this.getDriverDb().renameCollection(
      fromCollection,
      toCollection,
      options
    );
  }

  // Database Information

  async stats(options?: DbStatsOptions) {
    return this.getDriverDb().stats(options);
  }

  async command(command: Document, options?: RunCommandOptions) {
    return this.getDriverDb().command(command, options);
  }
}
