# @pipesafe/manifold

## 0.6.1

### Patch Changes

- 4fd4b30: Add default export condition to package.json exports for broader bundler compatibility

## 0.6.0

### Minor Changes

- 6cec201: Rename tmql monorepo to PipeSafe

  Breaking changes:
  - Package renamed from `tmql` to `@pipesafe/core`
  - Package renamed from `tmql-orchestration` to `@pipesafe/manifold`
  - All class prefixes removed: `TMPipeline` → `Pipeline`, `TMCollection` → `Collection`, etc.
  - Singleton renamed from `tmql` to `pipesafe`

## 0.5.1

### Patch Changes

- 36a681f: Sync package versions after initial tmql-orchestration publish
