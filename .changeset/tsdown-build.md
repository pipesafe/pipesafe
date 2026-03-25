---
"@pipesafe/core": minor
"@pipesafe/manifold": minor
---

Switch build tooling from raw tsc to tsdown (powered by Rolldown) with unbundle mode. Produces dual ESM/CJS output preserving source file structure for better tree-shaking. Dependencies auto-externalized from package.json.
