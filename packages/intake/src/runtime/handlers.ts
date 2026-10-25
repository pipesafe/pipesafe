/**
 * Runtime handlers - the entry points your infrastructure invokes
 *
 * These are plain functions over an IntakeStack. There is no provider, no
 * bundler and no deployment step here: wire them to a Lambda, a Cloud Run
 * service, an Express route, a Kubernetes CronJob or a long-lived Node
 * process, using whatever IaC you already have. `IntakeStack.manifest()`
 * tells you which resources to create and which handler each one invokes.
 *
 * Secrets are yours: provision them however you already do and pass values
 * in (verifiers take a `SecretValue`, handlers read `process.env`).
 */
import type { MongoClient } from "mongodb";
import type { IntakeLogger, IntakeRunResult } from "../intake/Intake";
import type { IntakeScope } from "../intake/Scope";
import type { IntakeStack } from "../stack/IntakeStack";
import { IntakeNotImplementedError } from "../errors";

export interface RuntimeOptions {
  /** Falls back to `pipesafe.client`; throws if neither is set. */
  client?: MongoClient;
  database?: string;
  logger?: IntakeLogger;
}

/** Framework-neutral request shape - adapt from your runtime in a few lines. */
export interface IntakeRequest {
  path: string;
  headers: Readonly<Record<string, string>>;
  /**
   * EXACT bytes as received. Do not parse and re-serialize before this:
   * HMAC verification breaks on re-serialized JSON.
   */
  rawBody: string;
}

export interface IntakeResponse {
  status: number;
  body?: string;
}

export interface DispatchResult {
  claimed: number;
  runs: number;
}

export interface SweepResult {
  redriven: number;
  dead: number;
}

/**
 * Receives verified webhook requests and lands envelopes. Route every
 * webhook path on the stack to this one handler; it dispatches by path.
 * Nothing else happens on this hot path - a duplicate envelope `_id` is an
 * ack, not an error.
 */
export function createGatewayHandler(
  _stack: IntakeStack,
  _options?: RuntimeOptions
): (request: IntakeRequest) => Promise<IntakeResponse> {
  throw new IntakeNotImplementedError("createGatewayHandler");
}

/**
 * Runs one intake over one scope. Invoked by the cron triggers in
 * `manifest().schedules` (which supply a resolved batch window), and
 * usable directly for an on-demand backfill.
 */
export function createRunHandler(
  _stack: IntakeStack,
  _options?: RuntimeOptions
): (input: { intake: string; scope: IntakeScope }) => Promise<IntakeRunResult> {
  throw new IntakeNotImplementedError("createRunHandler");
}

/**
 * Claims pending envelopes, coalesces their identifiers per intake, and
 * runs the event routes. Under `poll` dispatch this is a cron target; under
 * `changeStream` the watcher worker calls it. Because dispatch strategy is
 * per-intake, `manifest()` may emit several dispatch schedules with
 * different crons - each passes the intake names in its group.
 */
export function createDispatchHandler(
  _stack: IntakeStack,
  _options?: RuntimeOptions
): (input?: { intakes?: string[] }) => Promise<DispatchResult> {
  throw new IntakeNotImplementedError("createDispatchHandler");
}

/**
 * Re-drives failed envelopes with backoff and reaps anything stuck in
 * `received`/`processing`. This is what makes dispatch self-healing, so it
 * is not optional - give it a cron trigger.
 */
export function createSweeperHandler(
  _stack: IntakeStack,
  _options?: RuntimeOptions
): () => Promise<SweepResult> {
  throw new IntakeNotImplementedError("createSweeperHandler");
}
