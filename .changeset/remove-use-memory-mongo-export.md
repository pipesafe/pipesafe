---
"@pipesafe/core": patch
---

Remove the internal test helper `useMemoryMongo` from the public entry point. It statically imported `mongodb-memory-server` and `vitest` (dev-only dependencies), so merely importing `@pipesafe/core` in ESM environments failed with `Cannot find package 'mongodb-memory-server'` unless consumers installed it themselves (#100).
