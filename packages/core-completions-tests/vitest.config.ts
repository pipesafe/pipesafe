import { defineConfig } from "vitest/config";

// Package-local config: this suite is EXCLUDED from the root vitest run
// (see the root vitest.config.ts) because it pins the IDEAL autocomplete
// lists and is expected to fail until the known leaks are fixed. Run it
// with `bun run test:completions` from the root, or `bun run test` here.
export default defineConfig({
  test: {},
});
