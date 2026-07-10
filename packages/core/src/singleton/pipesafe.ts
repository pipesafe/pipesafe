import { MongoClient, MongoClientOptions, DbOptions } from "mongodb";
import { Database } from "../database/Database";
import { tagClient } from "./tagClient";

class PipeSafe {
  client: MongoClient | undefined;

  /**
   * Connect the global PipeSafe client.
   *
   * @param url MongoDB connection string
   * @param options Standard driver `MongoClientOptions` (timeouts, pool
   * sizing, TLS, etc.). PipeSafe's driver metadata is appended after any
   * user-supplied `driverInfo`, never replacing it.
   */
  connect(url: string, options?: MongoClientOptions) {
    if (this.client) throw new Error("Already connected");
    this.client = new MongoClient(url, options);
    tagClient(this.client);
    return this.client;
  }

  async close() {
    if (!this.client) throw new Error("Not connected");
    await this.client.close();
    this.client = undefined;
  }

  db(databaseName?: string | undefined, options?: DbOptions): Database {
    const dbName = databaseName ?? this.client?.db().databaseName;
    if (!dbName) throw new Error("Db name required");
    return new Database({
      client: this.client,
      databaseName: dbName,
      options,
    });
  }
}

export const pipesafe = new PipeSafe();
