/**
 * Browser/edge half of the `#loader` conditional import: keeps acorn and
 * Node builtins out of non-server bundles.
 */
function unsupported(): never {
  throw new Error(
    "PipeSafe: $function bodies are serialized on a server runtime only (Node, Bun or Deno)."
  );
}

export const parseScript: (code: string) => unknown = unsupported;
export const requireOptional: (id: string) => unknown = unsupported;
