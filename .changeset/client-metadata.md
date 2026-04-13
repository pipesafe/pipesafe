---
"@pipesafe/core": minor
"@pipesafe/manifold": minor
---

Tag user-supplied `MongoClient` instances with PipeSafe driver metadata at every entry point (`Collection`, `Database`, `Pipeline`, `Project`), not just the `pipesafe.connect()` singleton. Tagging is idempotent so wrapping the same client in multiple PipeSafe constructs will not duplicate entries in the server-side handshake log.
