import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/**
 * Scopes every temp directory the test run creates (in particular
 * mongodb-memory-server's per-instance dbPath dirs) to ONE run-owned
 * directory, and removes exactly that directory on teardown.
 *
 * Mechanism: mongodb-memory-server resolves its dbPath base via
 * `os.tmpdir()`, which honors TMPDIR (POSIX) / TEMP / TMP (Windows).
 * globalSetup runs in the vitest main process before workers spawn, so
 * the workers inherit the env and create their dirs inside `runTmpDir`.
 *
 * The teardown never touches anything it did not create: it deletes the
 * single mkdtemp directory owned by this run — including dirs a failed
 * suite left behind — and nothing else. Instances still clean their own
 * dbPath on the happy path (useMemoryMongo's afterAll stops with
 * doCleanup); this is the backstop.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const runTmpDir = await mkdtemp(join(tmpdir(), "pipesafe-test-run-"));

  process.env.TMPDIR = runTmpDir;
  process.env.TEMP = runTmpDir;
  process.env.TMP = runTmpDir;

  return async () => {
    await rm(runTmpDir, { recursive: true, force: true });
  };
}
