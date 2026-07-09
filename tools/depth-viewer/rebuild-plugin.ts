import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "public", "data");

/**
 * Dev-only endpoints that let the viewer rebuild its own dataset from the
 * browser (see the RebuildButton). The heavy work is exactly what
 * `depth-view:build` does — a cold `tsc --generateTrace` plus the registry
 * walk — so it is single-flighted: one child process at a time, a second
 * trigger while one is running is rejected rather than spawning a duplicate.
 *
 * Protocol (all under /__depth/rebuild):
 *   POST /__depth/rebuild          start a build; 202 + snapshot, or 409 if busy
 *   GET  /__depth/rebuild/stream   Server-Sent Events: one message per state change
 *   GET  /__depth/rebuild/status   the current snapshot as JSON (SSE-less fallback)
 *
 * The endpoints exist only under `vite serve` (apply: "serve"); the production
 * `vite build` never sees them.
 */

/** A phase the browser renders as a progress step. */
export interface RebuildSnapshot {
  /** Monotonic id — increments each time a build starts. */
  id: number;
  running: boolean;
  /** Human-readable target label, e.g. "coverage" or "sample". */
  target: string;
  /** Current phase text, derived from the build's stdout. */
  phase: string;
  startedAt: number;
  endedAt: number | null;
  /** Tail of the build's combined stdout/stderr (most recent last). */
  log: string[];
  /** Present once the build has finished. */
  exitCode: number | null;
  /** Present when the build failed — a short summary for the UI. */
  error: string | null;
}

/** How the browser names a build target; maps to a --project argument. */
type Target = "coverage" | "sample" | string;

const LOG_TAIL = 200;

/**
 * Map a known build.ts stdout line to a friendly phase. Unrecognised lines
 * leave the phase unchanged (but are still appended to the log tail).
 */
function phaseFor(line: string): string | null {
  if (line.includes("--generateTrace")) return "Generating trace (cold tsc)…";
  if (line.includes("Using stock tsc")) return "Generating trace (stock tsc)…";
  if (line.includes("Walking project AST")) return "Walking project AST…";
  if (line.includes("Attributing registry")) return "Attributing entries…";
  if (line.includes("per-node depth records")) return "Indexing depth records…";
  if (line.startsWith("Output:")) return "Writing dataset…";
  return null;
}

/** Resolve the browser's target name to build.ts arguments. */
function argsForTarget(target: Target, patch: boolean): string[] {
  const args = ["run", join(HERE, "build.ts")];
  if (target === "sample") {
    args.push("--project", "tools/depth-viewer/sample/tsconfig.json");
  } else if (target !== "coverage") {
    // Treat anything else as an explicit tsconfig path (relative to repo root).
    args.push("--project", target);
  }
  if (!patch) args.push("--no-patch");
  return args;
}

export function rebuildPlugin(): Plugin {
  let job: RebuildSnapshot = {
    id: 0,
    running: false,
    target: "coverage",
    phase: "idle",
    startedAt: 0,
    endedAt: null,
    log: [],
    exitCode: null,
    error: null,
  };
  let child: ChildProcess | null = null;
  const clients = new Set<ServerResponse>();

  const broadcast = (): void => {
    const payload = `data: ${JSON.stringify(job)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const pushLog = (chunk: string): void => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd();
      if (!line) continue;
      job.log.push(line);
      const phase = phaseFor(line);
      if (phase) job.phase = phase;
    }
    if (job.log.length > LOG_TAIL) job.log = job.log.slice(-LOG_TAIL);
    broadcast();
  };

  const start = (target: Target, patch: boolean): void => {
    job = {
      id: job.id + 1,
      running: true,
      target: typeof target === "string" ? target : "coverage",
      phase: "Starting…",
      startedAt: Date.now(),
      endedAt: null,
      log: [],
      exitCode: null,
      error: null,
    };
    broadcast();

    child = spawn("bun", argsForTarget(target, patch), {
      cwd: HERE,
      env: process.env,
    });
    child.stdout?.on("data", (b: Buffer) => pushLog(b.toString()));
    child.stderr?.on("data", (b: Buffer) => pushLog(b.toString()));
    child.on("error", (err) => {
      job.running = false;
      job.endedAt = Date.now();
      job.exitCode = -1;
      job.error = `Failed to spawn build: ${err.message}`;
      job.phase = "Failed";
      child = null;
      broadcast();
    });
    child.on("close", (code) => {
      job.running = false;
      job.endedAt = Date.now();
      job.exitCode = code ?? -1;
      if (code === 0) {
        job.phase = "Done";
      } else {
        job.phase = "Failed";
        // Surface the tail of the log — the compiler error is usually there.
        job.error = job.log.slice(-8).join("\n") || `Build exited with ${code}`;
      }
      child = null;
      broadcast();
    });
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => resolve(body));
      req.on("error", () => resolve(""));
    });

  return {
    name: "depth-viewer:rebuild",
    apply: "serve",
    configureServer(server) {
      // Serve the dataset JSON straight from disk. Vite's public/ static
      // middleware only picks up files that existed when the server started, so
      // a dataset the rebuild button just produced would otherwise fall through
      // to the SPA HTML fallback (a cryptic "Unexpected token <" in the app).
      // Reading from disk per request also means a missing dataset is an honest
      // 404 the app can turn into its empty-state.
      server.middlewares.use(
        "/data",
        (req: IncomingMessage, res: ServerResponse, next) => {
          const name = (req.url ?? "/").split("?")[0]?.replace(/^\//, "") ?? "";
          if (!/^[\w.-]+\.json$/.test(name)) {
            next();
            return;
          }
          const file = join(DATA_DIR, name);
          if (!existsSync(file)) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "dataset not built" }));
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache");
          createReadStream(file).pipe(res);
        }
      );

      server.middlewares.use(
        "/__depth/rebuild",
        (req: IncomingMessage, res: ServerResponse, next) => {
          const url = req.url ?? "/";

          // SSE progress stream.
          if (req.method === "GET" && url.startsWith("/stream")) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(`data: ${JSON.stringify(job)}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
          }

          // Snapshot fallback for clients without EventSource.
          if (req.method === "GET" && url.startsWith("/status")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(job));
            return;
          }

          // Trigger a build (single-flight).
          if (req.method === "POST") {
            if (job.running) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "already running", job }));
              return;
            }
            void readBody(req).then((body) => {
              let target: Target = "coverage";
              let patch = true;
              if (body) {
                try {
                  const parsed = JSON.parse(body) as {
                    target?: Target;
                    patch?: boolean;
                  };
                  if (parsed.target) target = parsed.target;
                  if (parsed.patch === false) patch = false;
                } catch {
                  // Ignore a malformed body and use defaults.
                }
              }
              start(target, patch);
              res.statusCode = 202;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ started: true, job }));
            });
            return;
          }

          next();
        }
      );
    },
  };
}
