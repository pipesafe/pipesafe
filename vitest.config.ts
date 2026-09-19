import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starts the one mongod the run shares and owns the temp dir its dbPath
    // lives in; the teardown stops that instance and removes that one
    // directory (see the file's doc).
    globalSetup: ["./vitest.globalSetup.ts"],
    // Suites are kept apart by database, not by process: `useMemoryMongo`
    // gives each test file its own database on the shared instance, so a
    // fresh module registry per file buys nothing and costs a setup. Keep it
    // off only while that holds — a test that leaves module state behind
    // (a connected singleton, a mock) has to clean up after itself.
    isolate: false,
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
