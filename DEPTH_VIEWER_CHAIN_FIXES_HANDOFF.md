# Handoff — depth-viewer initializer-chain display fixes

**Status:** two fixes applied and verified against a focused rebuild + live browser
render. Not yet run through the full repo verification suite, not yet folded into
PR #99. A resuming agent should finish verification and decide how to land it.

## Where things are

- **Branch:** `claude/depth-viewer-chain-fixes`, based on `19b09ed` (the head of
  PR #99 `claude/typescript-depth-limits-GlUsD`, which is a single commit on
  `main` = `f488fa7`).
- **Do NOT force-push #99 with this** until verified + a landing decision is made
  (options below). This branch is a WIP checkpoint.
- Two files changed:
  - `tools/depth-viewer/build.ts` — `callLine` computation in `buildInitializerChain`.
  - `tools/depth-viewer/src/components/DetailsPanel.tsx` — chain-step count rendering.
- Delete this handoff file before finalizing.

## The bug report (user)

In the initializer call-chain panel for `depthStressPipeline`:

1. The detonation step shows `⚠ depth 100  ⚠ count 5,000,356  tail 6` — the user
   believed the `5,000,356` count is an artefact and should read N/A, since this is
   the DEPTH stress pipeline and depth (100) is the "intended" trigger.
2. Steps after the cliff show `⚠ depth 100  tail 6` with no count — "closer but
   still not the full picture."
3. Every step's location reads `line 9 · sig at …Pipeline.d.mts:77` — the line
   number does not advance per stage.

## Diagnosis (reproduced deterministically)

Reproduced with a **focused, ~54s build** (not the 9-min coverage build):

```sh
mkdir -p /tmp/dv-stress
cat > /tmp/dv-stress/tsconfig.json <<'EOF'
{
  "extends": "/Users/timvyas/git/pipesafe/tsconfig.options.json",
  "compilerOptions": { "noEmit": true, "composite": false, "incremental": false, "types": [] },
  "include": ["/Users/timvyas/git/pipesafe/packages/core/examples/_stress-pipelines.ts"]
}
EOF
cd tools/depth-viewer && bun run build.ts --project /tmp/dv-stress/tsconfig.json
# then inspect: node -e '<read public/data/index.json>, find depthStressPipeline, print chain'
```

Measured chain profile for `depthStressPipeline` (121 steps):

| step                | callLine (was) | depth   | count         | hitCountLimit |
| ------------------- | -------------- | ------- | ------------- | ------------- |
| 0 (`new`)           | 9              | 2       | 10            | f             |
| 1 (`.set`)          | **9**          | 24      | 4,190         | f             |
| … linear climb …    | **9**          | +3/step | +~852/step    | f             |
| 25                  | **9**          | 98      | 22,139        | f             |
| **26 (detonation)** | **9**          | 100     | **5,000,356** | **t**         |
| 27…119              | **9**          | 100     | 0             | f             |
| 120 (inferred)      | **9**          | 100     | undefined     | f             |

Findings:

1. **`callLine` — REAL BUG.** `buildInitializerChain` computed the line with
   `call.getStart(sf)`. For a left-folded chain (`new Pipeline().set().set()…`),
   every `CallExpression`'s start is the leftmost token of the whole sub-expression
   — i.e. the `new Pipeline<…>()` at the chain root (line 9) — so every step
   reported line 9. FIXED.

2. **`count 5,000,356` — NOT an artefact; it is real and reproducible.** The
   focused build reproduces `5,000,356` _exactly_, matching the value the user saw
   in a full coverage build. `selfCount` is reset per checkExpression frame
   (frame-local, see `patch-tsc.ts` entry/exit hooks), so an exact match across two
   very different build contexts proves it is **not** global-counter contamination.
   What actually happens: at step 26 the accumulated ~100-deep type detonates — one
   `.set()` resolution performs ~5M instantiations _at the same step_ that
   instantiation depth saturates at 100. So this step genuinely trips BOTH the depth
   (100) and count (5,000,000) TS2589 ceilings. The `…356` overshoot is just where
   tsc bailed after crossing the count ceiling. (This is analogous to the
   generator's own note that tail can't be isolated from depth — here count rides
   along with depth at the detonation point.)
   - The display was misleading: it presented a bail-overshoot as a precise number
     and used the same `⚠` a pure count-stressor would. FIXED at display time (keep
     the raw data honest; present it clearly): the ceiling-hit step now renders
     `⚠ count ≥5,000,000` with a tooltip explaining the coincident ceilings.

3. **Post-cliff count hidden — the value is genuinely 0** (type already collapsed
   to `any`, so `.set()` on `any` does ~0 marginal instantiations). It was hidden by
   a `maxCount > 0` display guard. FIXED: now shows `count 0` for measured-zero
   steps (distinct from the last `depthInferred` step, which has no record and
   stays blank), completing the picture.

**Not a bug — do not "fix":** `sig at …Pipeline.d.mts:77` is constant because every
`.set()` resolves to the same `set` method declaration (step 0's `new` correctly
shows `:67`, the constructor). This is the signature-declaration location, not the
call-site line. The user conflated it with `callLine`; only `callLine` was wrong.

## Fixes applied

- `build.ts` `buildInitializerChain`: derive `callLine` from the _invocation site_
  — the `.set` member name (`call.expression.name`) for property-access calls, the
  `["set"]` key for element-access calls — instead of `call.getStart()`. New/plain
  calls fall back to the call's own start.
- `DetailsPanel.tsx` chain count `<span>`: render when `maxCount !== undefined`
  (was `> 0`); show `⚠ count ≥5,000,000` when `hitCountLimit`, else `count N`
  (including `count 0`); tooltips reworded to explain the ceiling bail and that
  count reads 0 after collapse.

## Verified

- `bun run --filter @pipesafe/depth-viewer build` (tsc -b + vite) — PASS.
- Focused rebuild → `callLine` now 9,10,11,…,129 (strictly increasing).
- Live render (dev server on :5180, HMR): detonation step reads
  `⚠ depth 100  ⚠ count ≥5,000,000  tail 6 · line 35`; post-cliff steps read
  `⚠ depth 100  count 0  tail 6 · line 36/37/…` with `resolved: any`.
- `prettier --write` + `eslint` clean on the two files.

## Remaining for the resuming agent

1. **Run the full suite** from repo root: `bun install`, `bun run build`,
   `bun run typecheck`, `bun run typecheck:packages`, `bun run test:ci`,
   `bun run lint`, `bun run format` (no churn), `bun run budget:check` (must stay at
   `main`'s `1,087,452 / 1,115,000` — these are tooling-only changes, zero core cost).
2. **UX decision to confirm with the user:** I chose `⚠ count ≥5,000,000` (honest
   about the ceiling bail) rather than the user's suggested `N/A`. Rationale: the
   count ceiling is genuinely hit, so N/A would hide a true fact. If the user
   prefers to suppress count entirely on a depth-driven bail, change the
   `hitCountLimit` branch in `DetailsPanel.tsx`. Also confirm whether showing
   `count 0` on ~90 post-cliff rows is wanted or too noisy.
3. **Landing decision:** either (a) fold into #99 via `git commit --amend` on
   `claude/typescript-depth-limits-GlUsD` + `--force-with-lease` (keeps #99 one
   commit), or (b) ship as a follow-up commit/PR on top of #99. Prefer (a) if #99
   hasn't merged; (b) if it has. Update the #99 PR body if folding in.
4. Optional: confirm against a full `depth-view:build` (coverage) that nothing else
   regressed at scale (~9 min, ~8 GB).

## Environment notes

- Local machine (macOS), repo at `/Users/timvyas/git/pipesafe`. The prior session's
  `/tmp/claude-*` worktrees are gone (machine migrated); the three PRs (#99 `19b09ed`,
  #104 `05ff7a0`, #101 `37c9f42`) are safe on the remote as independent single
  commits on `main`.
- A depth-viewer dev server may still be running (`bun run depth-view`, port 5180),
  currently serving the focused stress dataset in `public/data/` (gitignored).
- 18 untracked `*.png` screenshots in the working tree are the user's, pre-existing —
  leave them.
