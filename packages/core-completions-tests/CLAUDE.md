# core-completions-tests — IDE-autocomplete regression suite

Read README.md for the harness mechanics. Rules for agents:

- Every test pins an EXACT completion list (`expectExactly`). NEVER weaken
  an ideal to make a test pass — fix the core type, or change the ideal in
  a reviewed commit if the ideal itself was wrong.
- Operator/accumulator/system-variable vocabularies are imported from
  `@pipesafe/core`'s authoritative const arrays — do not hand-copy names
  here. Schema-derived lists (field selectors/paths/refs) belong to the
  fixture and are spelled locally.
- A known-bad position keeps its exact ideal but is marked `it.fails` with
  a `KNOWN BAD` comment naming the offending type; remove `.fails` the
  moment the type is fixed (vitest will force this — a fixed `it.fails`
  errors).
- The suite runs in the ordinary root `bun run test:ci`. The tests import
  the BUILT `@pipesafe/core` at runtime (for the arrays) but probe
  completions against core's SOURCE via tsconfig `paths` — after changing
  core's exported arrays, `bun run build` before trusting a local run.
- The completion-safety invariants that keep these ideals achievable live
  in the root CLAUDE.md ("IDE Autocomplete" section).
