import { MongoClient } from "mongodb";
import { Pipeline } from "../pipeline/Pipeline";
import type { CollectionConfig } from "../database/config";
import { Document } from "../utils/objects";
import { tagClient } from "../singleton/tagClient";
import { Source } from "../source/Source";
import type { CollectionInDatabase } from "./CollectionInDatabase";

/**
 * A collection with no database: a pipeline source or join target that
 * resolves in whichever database the pipeline runs in (`execute({ db })`,
 * `Project.run({ db })`, else the client's default database).
 *
 * For direct driver commands, use `Database.collection()`.
 */
export class Collection<Docs extends Document> implements Source<
  Docs,
  undefined
> {
  readonly sourceType = "collection" as const;

  /** @internal Phantom type for inference */
  readonly __outputType!: Docs;
  /** @internal Phantom database name: none */
  readonly __outputDb!: undefined;

  private client: MongoClient | undefined;
  private collection: CollectionConfig;

  constructor(args: {
    client?: MongoClient | undefined;
    collection: CollectionConfig;
  }) {
    this.client = args.client;
    this.collection = args.collection;
    tagClient(this.client);
  }

  getCollectionName(): string {
    return this.collection.name;
  }

  getOutputCollection(): CollectionConfig {
    return this.collection;
  }

  aggregate(): Pipeline<Docs, Docs> {
    return new Pipeline<Docs, Docs>({
      client: this.client,
      collection: this.collection,
    });
  }
}

export type InferCollectionType<
  C extends Collection<any> | CollectionInDatabase<any, any>,
> = C extends { __outputType: infer Docs } ? Docs : never;
