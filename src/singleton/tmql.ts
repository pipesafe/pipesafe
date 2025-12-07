import { MongoClient } from "mongodb";
import { TMDatabase } from "../database/TMDatabase";

class TMQL {
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

  db(databaseName?: string | undefined): TMDatabase {
    const dbName = databaseName ?? this.client?.db().databaseName;
    if (!dbName) throw new Error("Db name required");
    return new TMDatabase({
      client: this.client,
      databaseName: dbName,
    });
  }
}

export const tmql = new TMQL();
