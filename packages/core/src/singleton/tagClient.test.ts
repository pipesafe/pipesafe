import { describe, it, expect, vi } from "vitest";
import { MongoClient } from "mongodb";
import { Collection } from "../collection/Collection";
import { Database } from "../database/Database";
import { Pipeline } from "../pipeline/Pipeline";
import { tagClient, DRIVER_INFO } from "./tagClient";

function makeFakeClient() {
  const appendMetadata = vi.fn();
  const client = { appendMetadata } as unknown as MongoClient;
  return { client, appendMetadata };
}

describe("tagClient", () => {
  it("calls appendMetadata once with PipeSafe driver info", () => {
    const { client, appendMetadata } = makeFakeClient();
    tagClient(client);
    expect(appendMetadata).toHaveBeenCalledTimes(1);
    expect(appendMetadata).toHaveBeenCalledWith(DRIVER_INFO);
  });

  it("is idempotent: wrapping the same client multiple times only tags once", () => {
    const { client, appendMetadata } = makeFakeClient();

    new Collection({ client, collectionName: "c" });
    new Database({ client, databaseName: "d" });
    new Pipeline({ client });
    tagClient(client);

    expect(appendMetadata).toHaveBeenCalledTimes(1);
  });

  it("no-ops on drivers without appendMetadata", () => {
    const oldClient = {} as MongoClient;
    expect(() => tagClient(oldClient)).not.toThrow();
  });

  it("no-ops when client is undefined", () => {
    expect(() => tagClient(undefined)).not.toThrow();
  });
});
