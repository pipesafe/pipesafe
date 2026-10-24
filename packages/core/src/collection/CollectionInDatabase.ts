import {
  Collection as MongoCollection,
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
import { Pipeline, type InDatabase } from "../pipeline/Pipeline";
import type { CollectionConfig } from "../database/config";
import type { Database } from "../database/Database";
import { Document } from "../utils/objects";
import { Source } from "../source/Source";

/**
 * A collection bound to a {@link Database}. Owns the direct driver commands,
 * and its pipelines may only join sources in the same database.
 *
 * Created by `Database.collection()`.
 */
export class CollectionInDatabase<
  Docs extends Document,
  Db extends string = string,
> implements Source<Docs, Db> {
  readonly sourceType = "collection" as const;

  /** @internal Phantom type for inference */
  readonly __outputType!: Docs;
  /** @internal Phantom database name for same-database join checks */
  readonly __outputDb!: Db;

  readonly database: Database<Db>;
  private collection: CollectionConfig;

  /** @internal Use `Database.collection()` */
  constructor(database: Database<Db>, collection: CollectionConfig) {
    this.database = database;
    this.collection = collection;
  }

  getCollectionName(): string {
    return this.collection.name;
  }

  getOutputCollection(): CollectionConfig {
    return this.collection;
  }

  private getCollection(): MongoCollection<Docs> {
    return this.database
      .getDriverDb()
      .collection<Docs>(this.collection.name, this.collection.options);
  }

  // Aggregation

  aggregate(): Pipeline<Docs, Docs, InDatabase<Db>> {
    return new Pipeline<Docs, Docs, InDatabase<Db>>({
      client: this.database.getMongoClient(),
      db: this.database.getDbConfig(),
      collection: this.collection,
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
    return this.database
      .getDriverDb()
      .createCollection<Docs>(this.collection.name, options);
  }

  async drop(options?: DropCollectionOptions) {
    const collection = this.getCollection();
    return collection.drop(options);
  }
}
