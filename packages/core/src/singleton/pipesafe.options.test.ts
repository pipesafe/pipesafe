import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import { pipesafe } from "./pipesafe";
import { DRIVER_INFO } from "./tagClient";

// Constructing a MongoClient does not open a connection, so these tests
// exercise option plumbing without a live server.
describe("pipesafe.connect() options", () => {
  afterEach(async () => {
    if (pipesafe.client) await pipesafe.close();
  });

  it("passes MongoClientOptions through to the client", () => {
    const client = pipesafe.connect("mongodb://localhost:27017", {
      appName: "pipesafe-options-test",
      maxPoolSize: 7,
      serverSelectionTimeoutMS: 1234,
    });

    expect(client.options.appName).toBe("pipesafe-options-test");
    expect(client.options.maxPoolSize).toBe(7);
    expect(client.options.serverSelectionTimeoutMS).toBe(1234);
  });

  it("still tags PipeSafe driver info when options are provided", () => {
    const client = pipesafe.connect("mongodb://localhost:27017", {
      appName: "pipesafe-options-test",
    });

    expect(client.options.metadata.driver.name).toContain("PipeSafe");
  });

  it("appends PipeSafe driver info after a user-supplied driverInfo", () => {
    const appendSpy = vi.spyOn(MongoClient.prototype, "appendMetadata");
    try {
      const client = pipesafe.connect("mongodb://localhost:27017", {
        driverInfo: { name: "MyApp", version: "1.0.0" },
      });

      expect(appendSpy).toHaveBeenCalledWith(DRIVER_INFO);
      expect(client.options.metadata.driver.name).toContain("MyApp");
    } finally {
      appendSpy.mockRestore();
    }
  });
});
