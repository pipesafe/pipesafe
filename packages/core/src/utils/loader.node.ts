import { parse } from "acorn";
import { createRequire } from "node:module";

/**
 * Server-runtime half of the `#loader` conditional import (package.json
 * `imports`): Node, Bun and Deno resolve the `node` condition to this file.
 */
export function parseScript(code: string): unknown {
  return parse(code, { ecmaVersion: "latest" });
}

export const requireOptional: (id: string) => unknown = createRequire(
  import.meta.url
);
