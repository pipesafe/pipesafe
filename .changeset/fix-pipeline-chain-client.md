---
"@pipesafe/core": patch
---

Fix Pipeline.\_chain() not forwarding MongoClient, which caused execute() to throw "Not connected" after chained stages
