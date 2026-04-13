import { MongoClient } from "mongodb";
import { version } from "../../package.json";

const TAGGED = Symbol.for("pipesafe.clientTagged");

type Taggable = MongoClient & { [TAGGED]?: boolean };

export const DRIVER_INFO = { name: "PipeSafe", version };

/**
 * Appends PipeSafe's name/version to a user-supplied MongoClient's handshake
 * metadata so it shows up in server logs. Idempotent per client so wrapping
 * the same client in multiple PipeSafe constructs does not produce
 * "nodejs|PipeSafe|PipeSafe|PipeSafe" entries.
 */
export function tagClient(client: MongoClient | undefined): void {
  if (!client) return;
  const c = client as Taggable;
  if (c[TAGGED]) return;
  if (typeof c.appendMetadata !== "function") return;
  c.appendMetadata(DRIVER_INFO);
  markTagged(c);
}

/** Mark a client as already tagged so subsequent tagClient() calls are no-ops. */
export function markTagged(client: MongoClient): void {
  Object.defineProperty(client, TAGGED, {
    value: true,
    enumerable: false,
    configurable: true,
  });
}
