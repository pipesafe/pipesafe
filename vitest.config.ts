import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starts the one mongod the run shares and owns the temp dir its dbPath
    // lives in; the teardown stops that instance and removes that one
    // directory (see the file's doc).
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
