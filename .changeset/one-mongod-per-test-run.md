---
"@pipesafe/core": patch
---

Internal test plumbing, no published surface: the test run now starts one mongod in the vitest global setup and `useMemoryMongo` gives each test file its own database on it, instead of every suite starting a server of its own in `beforeAll`. Suite isolation is off as a result — the boundary between suites is the database, not the process.
