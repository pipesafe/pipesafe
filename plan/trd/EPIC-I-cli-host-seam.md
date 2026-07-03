# EPIC-I — CLI & host/control-plane seam

**Overview.** Ship a `manifold` CLI that makes manifold hostable by any scheduler (cron, GitHub Actions, Dagster, Temporal, Orchestra) through the three touchpoints every control plane uses: start a run, stream per-node status, fetch parseable artifacts ([plan 05 §5](../05-orchestration-and-el-roadmap.md)). The CLI is a thin seam: run semantics live in `@pipesafe/manifold` (EPIC-G executor + event log), artifact schemas live in EPIC-F. Priority P1. Related docs: [plan 05](../05-orchestration-and-el-roadmap.md) §5/§8, [plan 06](../06-architecture-packaging-licensing.md) §1/§5, [plan 04](../04-transform-roadmap.md) (selectors, artifacts); sketches: [run-event-log.spike.ts](../spikes/run-event-log.spike.ts), [manifest-artifact.spike.ts](../spikes/manifest-artifact.spike.ts).

## Spike findings

TRD-only epic — no runtime spike; grounded in the two existing sketches plus repo facts. Notable checks and contradictions:

- **The NDJSON contract already exists twice.** `run-event-log.spike.ts` declares the `ManifoldEvent` union and notes "this exact union is also the CLI's NDJSON stream." EPIC-G's event union is therefore THE single source of truth; this TRD adds only an envelope requirement (a `v` schema-version field — currently **absent** from the sketch union; raised to EPIC-G as a cross-TRD requirement).
- **Manifest filename contradiction.** Plan 05 §5 says `manifold.json`; `manifest-artifact.spike.ts` says `.manifold/manifest.json`; this epic's brief says `manifold-manifest.json`. Decision here: **`manifold-manifest.json`** at the project root (self-describing when copied into artifact stores, dagster-dbt-style single file), with run-results in `.manifold/run-results.json` per EPIC-F. Must be reconciled with EPIC-F before either ships.
- **Serverless/singleton hazard confirmed in source.** The core singleton throws on double connect, and `Project` takes models at construction — plan 05 §8.4's mitigation (per-invocation client injection, programmatic entrypoint) is a hard requirement on config loading (CLI-2), not an afterthought.
- **Licensing is genuinely unresolved.** Plan 06 §5 calls the CLI's license "the sharpest open question." This TRD proposes Apache shell / ELv2 engine (CLI-1) but flags it as requiring an explicit decision before release.

## Tickets

### CLI-1: `@pipesafe/cli` package, command grammar, exit codes

- **Priority** P1 | **Estimate** M | **Depends on** EPIC-G event log (runner semantics), EPIC-F selectors
- **Context**: dbt won distribution because one binary with stable flags and exit codes is hostable by anything. Manifold needs the same seam.
- **Design**: new workspace package `packages/cli` → `@pipesafe/cli`, `bin: { manifold }`. **License**: Apache-2.0 shell (arg parsing, config loading, NDJSON serialization, exit codes) peer-depending on ELv2 `@pipesafe/manifold` for execution — mirrors how ELv2's daily-use grant works in practice; **flag: plan 06 §5 requires an explicit sign-off on this split before publish.** Grammar:

  ```
  manifold run|build|test|ls|compile [flags]
    --select <sel> --exclude <sel>     graph selectors: 'stg_events+', '+mart_kpis',
                                       'tag:nightly', 'state:modified+' (EPIC-F/doc 04)
    --only-stale                       skip fresh models (EPIC-G staleness verdicts)
    --defer --state <dir>              read unselected upstreams per deferred manifest (EPIC-F)
    --json                             NDJSON events on stdout (CLI-3)
    --target <name>                    environment binding from manifold.config.ts (CLI-7)
    --project <path>                   config location (default: upward search)
    --full-refresh  --max-parallel <n>
  ```

  `run` = models only; `test` = tests only; `build` = both interleaved in DAG order; `ls` = print resolved selection (names, or node detail with `--json`); `compile` = CLI-5. **Exit codes** (the contract hosts branch on): `0` success (including empty selection); `1` model error or error-severity test failure (run completed, something failed); `2` config/usage error (bad selector, config not found, connection failure — nothing ran); `3` success with warn-severity test failures only (`--warn-error` promotes to `1`).

- **Acceptance criteria**: all five commands parse and dispatch; exit codes exactly as tabled; `manifold ls --select` on an example project prints the same set the executor would run; unknown flag → exit 2 with usage on stderr.
- **Test plan**: unit tests for arg parsing and exit-code mapping; integration test running the CLI as a subprocess against `mongodb-memory-server` fixtures asserting exit codes for success/model-fail/test-warn/bad-config.
- **Open questions**: license sign-off; `retry` command lands with EPIC-F run-results (not in v1).

### CLI-2: config discovery — `manifold.config.ts` executed in the user's runtime

- **Priority** P1 | **Estimate** L | **Depends on** CLI-1
- **Context**: the CLI must obtain the user's `Project` (typed TS code — the authoring layer is code, not YAML). dbt parses files; manifold must _execute_ them.
- **Design**: default entrypoint `manifold.config.ts` (upward search from cwd; `--project` overrides), default-exporting `defineProject({ project, targets })` where `targets` maps names → connection config. Loader strategy, in order: (1) under **bun**, plain `await import()` (native TS); (2) under **node ≥22.6**, native type-stripping where available; (3) fall back to registering the **user's own** `tsx`/`jiti` install; never bundle. Invoke via the package manager (`bunx manifold`) so module resolution and the `@pipesafe/manifold` instance are the _project's_ — the CLI shell must delegate execution to the project-local manifold to avoid dual class identities and version skew (dbt-adapter pattern). **Serverless**: export programmatic `runCli(argv, { client?, stdout? })` from `@pipesafe/cli` so a Lambda/Cloud Run handler can invoke a run per event with an injected `MongoClient` (avoids the singleton double-connect throw, plan 05 §8.4); document the "one model per invocation + resumeFrom" pattern for step-function hosts with short timeouts.
- **Acceptance criteria**: config discovered from nested cwd; same config loads under bun and node 22 LTS; injected-client path never touches the singleton; helpful exit-2 diagnostics for missing/throwing config.
- **Test plan**: fixture projects (bun + node runners in CI matrix); a config that throws; a config importing app code with TS-only syntax; programmatic `runCli` test with injected client.
- **Open questions**: support `manifold.config.{js,mjs}`? Multiple Projects per config (named projects) — defer.

### CLI-3: NDJSON stdout event contract

- **Priority** P1 | **Estimate** S | **Depends on** EPIC-G event union (the single source of truth)
- **Context**: dagster-dbt streams per-node JSON from one `dbt build`; Orchestra parses artifacts. Hosts must consume exactly what the log stores.
- **Design**: with `--json`, stdout carries **only** NDJSON — one EPIC-G `ManifoldEvent` per line, serialized as canonical JSON (Dates → ISO-8601), each line enveloped with `v: 1` (event-schema version; bump rules owned by EPIC-G). All human logs, progress, and warnings go to **stderr** in both modes; without `--json`, pretty per-model lines go to stdout. `run_finished` is always the last line and carries status + counts so a host can parse one line if it wants. No buffering: flush per event (hosts tail the stream live).
- **Acceptance criteria**: `manifold build --json | jq .` never errors on any line; stderr noise cannot corrupt stdout; every emitted event validates against the EPIC-G schema; `v` present on every line.
- **Test plan**: golden-file NDJSON snapshots per scenario (success, model failure, skip propagation); property test: interleave logger writes and assert stdout parses.
- **Open questions**: should non-`--json` mode also write the NDJSON to `.manifold/events.ndjson`? (Cheap, aids debugging; lean yes.)

### CLI-4: `manifold compile` — manifest emission + `ls`

- **Priority** P1 | **Estimate** S | **Depends on** EPIC-F manifest schema; CLI-2
- **Context**: the manifest is the seam that lets anyone write `dagster-manifold` in an afternoon (plan 05 §5.1).
- **Design**: `manifold compile` loads the project, builds all pipelines, computes canonical pipeline/config hashes (EPIC-F), and writes **`manifold-manifest.json`** (schema, versioning, unresolved-config rules all owned by EPIC-F — the CLI only serializes; see filename contradiction in findings). No database connection required — compile must work in CI without secrets. `ls --json` prints per-node manifest slices for the resolved selection.
- **Acceptance criteria**: compile succeeds with no reachable database; output validates against EPIC-F's published schema; hashes stable across runs and machines; `state:modified` computed from a prior manifest matches EPIC-F's reference algorithm.
- **Test plan**: snapshot manifest for the examples project; determinism test (two compiles, byte-identical modulo `generatedAt`/`invocationId`); cross-check selector results against EPIC-F fixtures.
- **Open questions**: none blocking; field-lineage extension deferred to EPIC-F P3.

### CLI-5: host consumption recipes — GitHub Actions slim CI + Dagster wrapper

- **Priority** P1 | **Estimate** M | **Depends on** CLI-1..4, EPIC-F defer/state
- **Context**: prove the seam by consuming it the way each host class does: artifact-diff CI (GitHub Actions), event-streaming orchestrator (Dagster), dumb trigger (cron/Orchestra webhook task).
- **Design**: documented, CI-tested recipes. GitHub Actions slim CI:

  ```yaml
  name: manifold-slim-ci
  on: pull_request
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install --frozen-lockfile
        - name: Fetch nightly prod artifacts (manifest + run-results)
          run: aws s3 cp s3://acme-artifacts/manifold/prod/ ./prod-state/ --recursive
        - name: Build changed models + descendants, deferring the rest to prod
          run: |
            bunx manifold build --select state:modified+ --defer --state ./prod-state \
              --target ci --json > events.ndjson
          env:
            MONGODB_URI_CI: ${{ secrets.CI_MONGODB_URI }}
        - uses: actions/upload-artifact@v4
          if: always()
          with:
            {
              name: manifold-run,
              path: "events.ndjson\n.manifold/run-results.json",
            }
  ```

  Dagster-style wrapper (pseudocode; the eventual `dagster-manifold` package is P3, plan 05 §8):

  ```python
  manifest = json.load(open("manifold-manifest.json"))
  specs = [AssetSpec(key=name, deps=manifest["parentMap"][name])
           for name in manifest["models"]]

  @multi_asset(specs=specs)
  def manifold_assets(context):
      sel = selection_arg(context.selected_output_names)   # models → --select
      proc = subprocess.Popen(["bunx", "manifold", "build", "--json", "--select", sel],
                              stdout=subprocess.PIPE)
      for line in proc.stdout:                              # stream, don't wait
          ev = json.loads(line)
          if ev["type"] == "model_materialized":
              yield MaterializeResult(asset_key=ev["model"],
                  metadata={"docsWritten": ev["docsWritten"],
                            "durationMs": ev["durationMs"],
                            "pipelineHash": ev["pipelineHash"]})
          elif ev["type"] == "model_failed" and not ev["willRetry"]:
              context.log.error(ev["error"])
      if proc.wait() not in (0, 3): raise Exception("manifold build failed")
  ```

  Cron/Orchestra recipe: `*/5 * * * * bunx manifold build --only-stale --json >> runs.ndjson` — the Orchestra-validated skip story kept in-product (plan 05 §4).

- **Acceptance criteria**: the Actions workflow runs green in this repo against a memory-server service container; Dagster pseudocode published in docs and validated against a recorded NDJSON fixture; each recipe states which exit codes it treats as failure.
- **Test plan**: repo CI job executing the slim-CI recipe end to end; fixture-replay test for the wrapper's event handling.
- **Open questions**: ship the Dagster wrapper as a real package now? No — P3 per plan 05 §8; recipes only.

### CLI-6: auth & connection-string handling

- **Priority** P1 | **Estimate** S | **Depends on** CLI-2
- **Context**: hosts inject secrets via env; serverless hosts inject clients; nothing may leak into argv, events, or artifacts.
- **Design**: resolution order per target: explicit client injection (programmatic API) → `targets[name].uri` in config, with an `env("VAR")` helper for interpolation → `MONGODB_URI` fallback. **Never** accept URIs as CLI flags (visible in `ps`/CI logs). Redact credentials in every error message, NDJSON event, and artifact (manifest stores unresolved `{ db: null }` names per EPIC-F, so URIs never enter artifacts by construction). `--target` selects the binding; `manifold compile` requires none.
- **Acceptance criteria**: grep of all emitted bytes (stdout, stderr, artifacts) for a fixture password finds nothing; missing env var → exit 2 naming the variable, not the URI.
- **Test plan**: integration test with a password-bearing URI asserting redaction across failure modes (bad auth, bad host, mid-run failure).
- **Open questions**: TLS/X.509 and AWS-IAM auth options pass through the driver untouched — document only.

**Non-goals** (plan 05 §4/§8): no scheduler daemon, no cron parser, no HTTP trigger in v1 (a 20-line express wrapper once semantics exist), no hosted control plane.
