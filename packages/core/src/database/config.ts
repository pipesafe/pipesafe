import type { CollectionOptions, DbOptions } from "mongodb";

export type DbConfig = { name: string; options?: DbOptions };
export type CollectionConfig = { name: string; options?: CollectionOptions };
