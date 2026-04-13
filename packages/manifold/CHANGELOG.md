# @pipesafe/manifold

## 0.8.0

### Minor Changes

- 079eeec: Tag user-supplied `MongoClient` instances with PipeSafe driver metadata at every entry point (`Collection`, `Database`, `Pipeline`, `Project`), not just the `pipesafe.connect()` singleton. Tagging is idempotent so wrapping the same client in multiple PipeSafe constructs will not duplicate entries in the server-side handshake log.

## 0.7.0

### Minor Changes

- 1647d74: Switch build tooling from raw tsc to tsdown (powered by Rolldown) with unbundle mode. Produces dual ESM/CJS output preserving source file structure for better tree-shaking. Dependencies auto-externalized from package.json.

### Patch Changes

- 4fd4b30: Add default export condition to package.json exports for broader bundler compatibility
- 1647d74: Move mongodb from dependencies to peerDependencies to prevent duplicate MongoClient types when consumers link PipeSafe locally or use a different mongodb resolution path

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
