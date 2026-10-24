import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/eslint-plugin/index.ts",
    "./src/utils/loader.node.ts",
    "./src/utils/loader.default.ts",
  ],
  format: ["esm", "cjs"],
  dts: { resolver: "tsc" },
  clean: false,
  unbundle: true,
  // `#loader` resolves per runtime at the consumer — never bundle it
  deps: { skipNodeModulesBundle: true, neverBundle: ["#loader"] },
});
