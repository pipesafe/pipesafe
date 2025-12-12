import {
  MongoClient,
  Collection,
  Filter,
  UpdateFilter,
  DeleteOptions,
  UpdateOptions,
  InsertOneOptions,
  BulkWriteOptions,
  ReplaceOptions,
  FindOptions,
  OptionalUnlessRequiredId,
  WithoutId,
  AnyBulkWriteOperation,
  CountDocumentsOptions,
  EstimatedDocumentCountOptions,
  FindOneAndUpdateOptions,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  DistinctOptions,
  IndexSpecification,
  CreateIndexesOptions,
  IndexDescription,
  DropIndexesOptions,
  ListIndexesOptions,
  CreateCollectionOptions,
  DropCollectionOptions,
} from "mongodb";
import { TMPipeline } from "../pipeline/TMPipeline";
import { Document } from "../utils/core";
import { tmql } from "../singleton/tmql";

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

  // Accessors

  getCollectionName(): string {
    return this.collectionName;
  }

  private getClient() {
    const client = this.client ?? tmql.client;
    if (!client) {
      throw new Error(
        "No client available. Either pass a client to TMCollection or connect via tmql.connect()"
      );
    }
    return client;
  }

  private getDatabase() {
    const client = this.getClient();
    return this.databaseName ? client.db(this.databaseName) : client.db();
  }

  private getCollection(): Collection<Docs> {
    return this.getDatabase().collection<Docs>(this.collectionName);
  }

  // Aggregation

  aggregate(): TMPipeline<Docs, Docs> {
    return new TMPipeline<Docs, Docs>({
      client: this.client,
      databaseName: this.databaseName,
      collectionName: this.collectionName,
    });
  }

  // Query

  find(filter?: Filter<Docs>, options?: FindOptions) {
    const collection = this.getCollection();
    return collection.find(filter || {}, options);
  }

  async findOne(filter?: Filter<Docs>, options?: FindOptions) {
    const collection = this.getCollection();
    return collection.findOne(filter || {}, options);
  }

  // Insert

  async insertOne(
    doc: OptionalUnlessRequiredId<Docs>,
    options?: InsertOneOptions
  ) {
    const collection = this.getCollection();
    return collection.insertOne(doc, options);
  }

  async insertMany(
    docs: OptionalUnlessRequiredId<Docs>[],
    options?: BulkWriteOptions
  ) {
    const collection = this.getCollection();
    return collection.insertMany(docs, options);
  }

  // Update

  async updateOne(
    filter: Filter<Docs>,
    update: UpdateFilter<Docs>,
    options?: UpdateOptions
  ) {
    const collection = this.getCollection();
    return collection.updateOne(filter, update, options);
  }

  async updateMany(
    filter: Filter<Docs>,
    update: UpdateFilter<Docs>,
    options?: UpdateOptions
  ) {
    const collection = this.getCollection();
    return collection.updateMany(filter, update, options);
  }

  async replaceOne(
    filter: Filter<Docs>,
    replacement: WithoutId<Docs>,
    options?: ReplaceOptions
  ) {
    const collection = this.getCollection();
    return collection.replaceOne(filter, replacement, options);
  }

  // Delete

  async deleteOne(filter?: Filter<Docs>, options?: DeleteOptions) {
    const collection = this.getCollection();
    return collection.deleteOne(filter || {}, options);
  }

  async deleteMany(filter?: Filter<Docs>, options?: DeleteOptions) {
    const collection = this.getCollection();
    return collection.deleteMany(filter || {}, options);
  }

  // Find and Modify

  async findOneAndUpdate(
    filter: Filter<Docs>,
    update: UpdateFilter<Docs>,
    options?: FindOneAndUpdateOptions
  ) {
    const collection = this.getCollection();
    return collection.findOneAndUpdate(filter, update, options ?? {});
  }

  async findOneAndReplace(
    filter: Filter<Docs>,
    replacement: WithoutId<Docs>,
    options?: FindOneAndReplaceOptions
  ) {
    const collection = this.getCollection();
    return collection.findOneAndReplace(filter, replacement, options ?? {});
  }

  async findOneAndDelete(
    filter: Filter<Docs>,
    options?: FindOneAndDeleteOptions
  ) {
    const collection = this.getCollection();
    return collection.findOneAndDelete(filter, options ?? {});
  }

  // Bulk Operations

  async bulkWrite(
    operations: AnyBulkWriteOperation<Docs>[],
    options?: BulkWriteOptions
  ) {
    const collection = this.getCollection();
    return collection.bulkWrite(operations, options);
  }

  // Count and Distinct

  async countDocuments(filter?: Filter<Docs>, options?: CountDocumentsOptions) {
    const collection = this.getCollection();
    return collection.countDocuments(filter, options);
  }

  async estimatedDocumentCount(options?: EstimatedDocumentCountOptions) {
    const collection = this.getCollection();
    return collection.estimatedDocumentCount(options);
  }

  async distinct<Key extends keyof Docs>(
    key: Key,
    filter?: Filter<Docs>,
    options?: DistinctOptions
  ) {
    const collection = this.getCollection();
    return collection.distinct(key as string, filter ?? {}, options ?? {});
  }

  // Index Management

  async createIndex(
    indexSpec: IndexSpecification,
    options?: CreateIndexesOptions
  ) {
    const collection = this.getCollection();
    return collection.createIndex(indexSpec, options);
  }

  async createIndexes(
    indexSpecs: IndexDescription[],
    options?: CreateIndexesOptions
  ) {
    const collection = this.getCollection();
    return collection.createIndexes(indexSpecs, options);
  }

  async dropIndex(indexName: string, options?: DropIndexesOptions) {
    const collection = this.getCollection();
    return collection.dropIndex(indexName, options);
  }

  async dropIndexes(options?: DropIndexesOptions) {
    const collection = this.getCollection();
    return collection.dropIndexes(options);
  }

  listIndexes(options?: ListIndexesOptions) {
    const collection = this.getCollection();
    return collection.listIndexes(options);
  }

  async indexExists(indexes: string | string[], options?: ListIndexesOptions) {
    const collection = this.getCollection();
    return collection.indexExists(indexes, options);
  }

  async indexes(options?: ListIndexesOptions) {
    const collection = this.getCollection();
    return collection.indexes(options);
  }

  // Collection Management

  async createCollection(options?: CreateCollectionOptions) {
    return this.getDatabase().createCollection<Docs>(
      this.collectionName,
      options
    );
  }

  async drop(options?: DropCollectionOptions) {
    const collection = this.getCollection();
    return collection.drop(options);
  }
}

export type InferCollectionType<Collection extends TMCollection<any>> =
  Collection extends TMCollection<infer Docs> ? Docs : never;
