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
    // Internal code must use the new names, never the deprecated compat
    // aliases — compat.ts exists solely for external consumers via index.ts
    // (docs/type-standardisation-plan.md §3.7).
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
            {
              group: ["**/compat"],
              message:
                "Internal code must not import from compat.ts — use the replacement named in the alias's @deprecated doc (docs/type-standardisation-plan.md §3.7)",
            },
          ],
        },
      ],
    },
  },
]);
