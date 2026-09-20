import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

/**
 * Starts the ONE mongod the whole run shares, and scopes every temp directory
 * the run creates to ONE run-owned directory.
 *
 * The server: `useMemoryMongo` hands each test file its own database on this
 * instance instead of starting an instance of its own (see that file for why).
 * The URI is published with `provide`, so a worker reads it with
 * `inject("memoryMongoUri")`.
 *
 * The temp directory: mongodb-memory-server resolves its dbPath base via
 * `os.tmpdir()`, which honors TMPDIR (POSIX) / TEMP / TMP (Windows). Those are
 * set before the instance is created so its dbPath lands inside `runTmpDir`,
 * and globalSetup runs in the vitest main process before workers spawn, so
 * anything a worker puts in the temp dir lands there too.
 *
 * The teardown never touches anything it did not create: it stops the instance
 * it started and deletes the single mkdtemp directory owned by this run, and
 * nothing else. Neither layer survives a hard kill of the vitest main process.
 */
export default async function globalSetup(
  project: TestProject
): Promise<() => Promise<void>> {
  const runTmpDir = await mkdtemp(join(tmpdir(), "pipesafe-test-run-"));

  process.env.TMPDIR = runTmpDir;
  process.env.TEMP = runTmpDir;
  process.env.TMP = runTmpDir;

  const memoryReplSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  project.provide("memoryMongoUri", memoryReplSet.getUri());

  return async () => {
    await memoryReplSet.stop({ doCleanup: true });
    await rm(runTmpDir, { recursive: true, force: true });
  };
}
