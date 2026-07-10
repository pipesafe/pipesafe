import { MongoClient, MongoClientOptions, DbOptions } from "mongodb";
import { Database } from "../database/Database";
import { DRIVER_INFO, markTagged, tagClient } from "./tagClient";

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
    // Do NOT collapse the branches into tagClient() alone: tagClient uses
    // appendMetadata, which needs mongodb >= 6.18, while the peer floor is
    // lower — the constructor-level driverInfo below works on the whole
    // peer range. With a user driverInfo we must append instead (the
    // constructor option holds a single entry), so that path is
    // best-effort on drivers without appendMetadata.
    if (options?.driverInfo) {
      this.client = new MongoClient(url, options);
      tagClient(this.client);
    } else {
      this.client = new MongoClient(url, {
        ...options,
        driverInfo: DRIVER_INFO,
      });
      markTagged(this.client);
    }
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
