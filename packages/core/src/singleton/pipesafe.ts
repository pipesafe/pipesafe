import { MongoClient } from "mongodb";
import { Database } from "../database/Database";

class PipeSafe {
  client: MongoClient | undefined;
  connect(url: string) {
    if (this.client) throw new Error("Already connected");
    this.client = new MongoClient(url);
    return this.client;
  }
  async close() {
    if (!this.client) throw new Error("Not connected");
    await this.client.close();
    this.client = undefined;
  }

  db(databaseName?: string | undefined): Database {
    const dbName = databaseName ?? this.client?.db().databaseName;
    if (!dbName) throw new Error("Db name required");
    return new Database({
      client: this.client,
      databaseName: dbName,
    });
  }
}

export const pipesafe = new PipeSafe();
