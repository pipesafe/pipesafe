import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // core's `#loader` maps to dist via package.json `imports`; run on source
  resolve: {
    alias: {
      "#loader": fileURLToPath(
        new URL("./packages/core/src/utils/loader.node.ts", import.meta.url)
      ),
    },
  },
  test: {
    // Run-owned temp dir for mongodb-memory-server dbPaths; the teardown
    // deterministically removes that one directory (see the file's doc).
    globalSetup: ["./vitest.globalSetup.ts"],
    // Excludes Vitest's built-in defaults plus `.claude/` so stray Claude
    // Code worktrees (e.g. `.claude/worktrees/<feature>/`) aren't picked up
    // and don't double-run the test suite.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "**/.claude/**",
    ],
  },
});
