import type { CollectionOptions, DbOptions } from "mongodb";

export type DbConfig = { name: string; options?: DbOptions | undefined };
export type CollectionConfig = {
  name: string;
  options?: CollectionOptions | undefined;
};
