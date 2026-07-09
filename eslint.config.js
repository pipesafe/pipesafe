import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const ignorePatterns = [".claude/**/*", "**/dist/**/*", "benchmarks/**/*"];

// PipeSafe's own $function lint rule (a built artifact — tolerate a missing
// dist so `bun run lint` still works on a fresh clone before the first
// build; the pre-commit hook runs build alongside lint).
let pipesafePlugin = null;
try {
  pipesafePlugin = (await import("@pipesafe/core/eslint-plugin")).default;
} catch {
  // not built yet — rule simply not applied
}

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
  {
    // CommonJS fixtures/scripts get Node globals (module, require, ...).
    files: ["**/*.cjs"],
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
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
  {
    files: ["packages/*/src/**/*.{ts,mts,cts}"],
    ignores: ["packages/*/src/index.ts"],
    rules: {
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
    },
  },
  // Enforce self-contained $function bodies in our own sources and examples.
  // Test and type-assertion files are exempt — they intentionally exercise
  // the invalid cases.
  ...(pipesafePlugin ?
    [
      {
        files: ["packages/**/*.ts"],
        ignores: ["**/*.test.ts", "**/*.typeAssertions.ts"],
        plugins: { pipesafe: pipesafePlugin },
        rules: { "pipesafe/no-impure-function-body": "error" },
      },
    ]
  : []),
]);
