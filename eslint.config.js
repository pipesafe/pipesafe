import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const ignorePatterns = [".claude/**/*", "**/dist/**/*", "benchmarks/**/*"];

export default defineConfig([
  { ignores: ignorePatterns },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.browser },
  },
  // Node-context tooling: CLI scripts, Vite configs, build helpers. These
  // use `process`, `__dirname`, etc. and would fail with browser-only globals.
  {
    files: [
      "tools/depth-blame.ts",
      "tools/depth-viewer/vite.config.ts",
      "tools/depth-viewer/build.ts",
      "tools/depth-viewer/query.ts",
      "eslint.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    ...tseslint.configs.strictTypeChecked[0],
    rules: {
      // Prevent cross-package relative imports - use package names instead
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/packages/**"],
              message:
                'Use package imports (e.g., "@pipesafe/core") instead of relative cross-package imports',
            },
          ],
        },
      ],
      // Disable base rule and use TypeScript-specific version
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          args: "after-used",
        },
      ],
    },
  },
]);
