# EPIC-K — Agent channel: MCP server, skills, templates, evals

**Overview.** Make PipeSafe the thing coding agents reach for when a project is already MongoDB. The channel evidence is in [plan 08](../08-supabase-baas-assessment.md): AI agents deploy the majority of Supabase's new databases (Claude Code its largest single deployer since early 2026), the Lovable/Bolt "Platforms" channel grew 370% in six months, and Prisma Next already ships SKILL.md skills plus an MCP server — agent assets are now table stakes, and agents follow defaults and docs. PipeSafe's unfair advantage is the `PipeSafeError<Msg>` brand catalogue: compile errors written as English sentences (`Operator '$gte' requires a numeric or date field.`) are diagnostics designed to be READ by an LLM and repaired in one round-trip. **Goal**: an MCP server, in-repo skill/docs assets, an instant-start template, and an eval harness that keeps the assets honest. **Out of scope**: hosted anything (no provisioning/cloud — plan 05 §4, plan 06), IDE plugins, builder-specific integrations (Lovable/Bolt ride on MCP + docs). Priority P1. Related docs: [plan 08](../08-supabase-baas-assessment.md), [plan 02](../02-competitive-landscape.md), [plan 06](../06-architecture-packaging-licensing.md) §4. No spike (TRD-only).

## Spike findings

TRD-only epic — no runtime spike. Grounded in repo facts:

- **The error catalogue already exists as a spec.** CLAUDE.md's brand-message skeleton (Operator/Accumulator/Stage/Field/Foreign-collection subjects, one sentence, no hint parentheticals) is exactly an agent affordance; AGENT-4 publishes it rather than inventing one. The known `group` call-site silence must be documented so agents annotate `GroupQuery<Schema>` explicitly.
- **The validation tool has in-repo precedent.** `.claude/inspect-types.ts` already extracts types via the TS compiler, and `ts-morph` 27 is a root devDependency — AGENT-2 productizes an existing internal workflow.
- **The run/status seam is EPIC-I, verbatim.** CLI-3's versioned NDJSON events (`run_finished` last) and CLI-1's exit codes are precisely what an MCP tool wraps.

## Tickets

### AGENT-1: `@pipesafe/mcp` server + schema introspection tools

- **Priority** P1 | **Estimate** M | **Depends on** EPIC-I CLI seam (CLI-2 config discovery — the server loads the user's project the same way)
- **Context**: agents can't write typed pipelines against schemas they can't see.
- **Design**: new workspace package `packages/mcp` → `@pipesafe/mcp`, `bin: { pipesafe-mcp }`, stdio transport (`@modelcontextprotocol/sdk`). Registered collections/models from `manifold.config.ts` (CLI-2 loader) are the introspection universe. Tools:
  - `list_sources() → [{ name, kind: "collection" | "model", db, hasJsonSchema }]`
  - `get_schema({ source }) → { typescript, fieldPaths: [{ path, type, optional }] }` — TS type text (ts-morph) plus flattened `FieldSelector`-style paths.
  - `sample_documents({ source, limit ≤ 5 })` — only when a connection is configured; values redacted by default (`"<string>"`).
- **Acceptance criteria**: passes MCP inspector conformance; `get_schema` paths match `FieldSelector<T>` for a nested+array schema; only `sample_documents` ever needs a DB connection.
- **Test plan**: golden-file tool outputs for example schemas; no-config fixture returns a structured "how to configure" error.
- **Open questions**: license — lean Apache (channel asset, plan 06 §4); settle alongside the CLI decision.

### AGENT-2: `validate_pipeline` — compile-check with `PipeSafeError` diagnostics

- **Priority** P1 | **Estimate** L | **Depends on** AGENT-1
- **Context**: the differentiator — an agent submits a pipeline snippet and gets back the branded sentence as structured data, not raw TS noise.
- **Design**: `validate_pipeline({ source, sourceName? }) → { ok, resultType?, diagnostics: [{ tsCode, message, pipesafeError?, line, col }] }`. Wrap the snippet in a virtual file importing the user's schemas (ts-morph in-memory project seeded with the project tsconfig — strict flags matter), collect diagnostics, and extract the `Msg` literal wherever the elaborated message contains `PipeSafeError<"...">` (the TS2322 value-position convention makes this a regex; TS2353 reported as-is). On success, `resultType` is the terminal generic's text. Plus `scaffold_pipeline({ source })` returning a templated correct-by-construction starter chain.
- **Acceptance criteria**: for each brand site in CLAUDE.md (`match`, `project`, `unwind`, `lookup`, expressions, `group` via annotated literal), a known-bad snippet yields `pipesafeError` equal to the exact catalogue sentence; valid snippets return `ok: true` in < 3s warm.
- **Test plan**: table-driven fixtures pinned to `Pipeline.callSite.typeAssertions.ts` (the regression guard and this tool must never disagree); cold/warm latency benchmark.
- **Open questions**: cache the ts-morph project across calls (invalidation on file change)?

### AGENT-3: manifold run/status tools over the EPIC-I seam

- **Priority** P1 | **Estimate** S | **Depends on** EPIC-I CLI-1/CLI-3; EPIC-G event log (status derives from it)
- **Context**: agents that build models must run and observe them without inventing shell incantations.
- **Design**: `manifold_run({ select?, dryRun? })` spawns project-local `bunx manifold build --json` (CLI-2 delegation rule), consumes NDJSON, returns `{ exitCode, summary, failures }` — never raw logs. `manifold_status()` reads the `_manifold` summary for last-run + staleness per model. Long runs return after a time budget with a cursor into `.manifold/events.ndjson` (this ticket wants CLI-3's open question answered "yes").
- **Acceptance criteria**: a failed run surfaces model name, error, skipped descendants; secrets never appear (CLI-6 redaction inherited, asserted).
- **Test plan**: memory-server fixture project; success/failure/skip golden results; redaction grep.
- **Open questions**: none blocking — deliberately a thin wrapper so the CLI stays the single seam.

### AGENT-4: SKILL.md, llms.txt, and the error catalogue as published docs

- **Priority** P1 | **Estimate** M | **Depends on** — (content); docs site for hosting
- **Context**: skills are how agents load "how to hold the tool" without discovery cost; the training-data flywheel punishes latecomers.
- **Design**: in-repo `skills/pipesafe/SKILL.md` + `skills/manifold/SKILL.md` (mirroring the license split), mirrored on the docs site with `/llms.txt` and `/llms-full.txt`. Content contract: correct-by-construction examples only (every fenced snippet compiled in CI via AGENT-2 machinery); the **branded-error catalogue** as a generated table — sentence → cause → fix — framed as "the sentence is the whole diagnosis"; known holes (group call-site silence → annotate `GroupQuery<Schema>`); scaffold conventions from AGENT-5.
- **Acceptance criteria**: CI compiles every snippet; catalogue generated from brand-site sources so it can't drift; llms.txt validates.
- **Test plan**: snippet-compile CI; drift test failing when a new `PipeSafeError<...>` literal lands in `packages/core/src` without a catalogue row.
- **Open questions**: ship skills inside the npm packages too (agents find them via node_modules, Prisma-style)? Lean yes.

### AGENT-5: `create-pipesafe-app` instant-start template

- **Priority** P1 | **Estimate** M | **Depends on** AGENT-4 (embeds the skill); EPIC-I CLI (scripts call it)
- **Context**: the channel begins at "working in seconds". PipeSafe can't provision Atlas, but `mongodb-memory-server` gives a real credential-free database — instant dev-mode start is achievable today.
- **Design**: `bunx create-pipesafe-app my-app` scaffolds: typed schema module, one collection + one example `Model`, `manifold.config.ts` with `dev` (a `dev-db.ts` helper booting `MongoMemoryReplSet` — replica set so change streams/transactions work) and `prod` (`env("MONGODB_URI")`) targets, `skills/` copied in, and scripts (`dev`, `manifold build`). Plain TS, bun-first, node-compatible, no framework lock-in.
- **Acceptance criteria**: scaffold → `bun install` → `bun run dev` works offline (post binary download) with zero config; an agent given only the scaffold + skill completes the AGENT-6 baseline tasks.
- **Test plan**: CI e2e scaffolding into a temp dir, dev flow on bun and node 22.
- **Open questions**: template variants (core-only vs +manifold) — start with one.

### AGENT-6: agent evals — the honesty harness

- **Priority** P1 | **Estimate** M | **Depends on** AGENT-1..5 (it measures them)
- **Context**: without measurement the skill assets rot into marketing; the eval also catches "a core type change broke agent ergonomics".
- **Design**: `evals/agent-channel/` — ~15 task fixtures (write a `$group` rollup; fix a typo'd path; add a `$lookup`; make a model incremental; repair a seeded `PipeSafeError`), each with a programmatic grader (compile + result-set assertion on memory-server; no LLM judging). Runner executes a coding agent (Claude Code headless first, runner abstracted) across {no assets | SKILL.md | SKILL.md + MCP}, emitting pass rate, round-trips, and tokens per condition to a checked-in scoreboard.
- **Acceptance criteria**: runs in CI on demand (cost — not per-PR); scoreboard shows a real with-assets delta or the assets get rewritten; every catalogue claim has an eval exercising it.
- **Test plan**: grader unit tests with hand-written good/bad solutions; graders deterministic even though agents aren't.
- **Open questions**: additional runners (Cursor CLI, Codex) and per-run budget — maintainer call.
