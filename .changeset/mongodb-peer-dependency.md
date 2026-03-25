---
"@pipesafe/core": patch
"@pipesafe/manifold": patch
---

Move mongodb from dependencies to peerDependencies to prevent duplicate MongoClient types when consumers link PipeSafe locally or use a different mongodb resolution path
