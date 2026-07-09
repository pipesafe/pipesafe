# @pipesafe/core-completions-tests

IDE-autocomplete regression tests for `@pipesafe/core`.

Editors don't invent completion lists — VS Code, JetBrains, and every
`typescript-language-server` client ask tsserver, and tsserver answers via
`LanguageService.getCompletionsAtPosition`. Driving that API directly in a
vitest suite therefore tests exactly what a user sees on Ctrl+Space, minus
client-side fuzzy filtering.

## How it works

`src/harness.ts` builds one language service over this package's
`tsconfig.json` plus a single **virtual** file inside `src/` (never written
to disk). The virtual file does `import { Pipeline } from "@pipesafe/core"`;
the tsconfig `paths` entry maps that to core's _source_ entry point, so the
tests need no prior build and type fixes show up without rebuilding. Each
probe:

1. takes a full source snippet containing exactly one `‸` cursor marker,
2. swaps it into the virtual file (bumping its version, so only that file
   re-parses — probes after the first cost ~50–300 ms),
3. asks for completions at the marker's offset and returns the entries.

```ts
const probe = tester.completionsAt(FIXTURE + `orders.match({ ‸ });`);
probe.names; //=> ["_id", "status", …, "$and", "$or", …]
probe.isMemberCompletion; //=> true
```

## The contract: exhaustive ideal lists, exact match

Every test pins the IDEAL completion list for its position and asserts
**exact** (order-insensitive) equality via `expectExactly`:

- an EXTRA entry is a leak (structural methods like `exec`/`getDate`, the
  `~pipesafe.error` brand key, global-identifier fallback);
- a MISSING entry is a lost suggestion (absorbed literal unions, missing
  refs);
- `memberCompletion: true` additionally requires TS to produce a
  _contextual_ key list — `false` inside an object literal means the editor
  falls back to ~1000 global identifiers.

Positions that are known-bad today are annotated with `KNOWN BAD` comments
naming the offending type, and their tests FAIL BY DESIGN until the type is
fixed. **Do not weaken an ideal list to make a test pass** — fix the type,
or if the ideal itself was wrong, change the list in a reviewed commit.

The ideal operator/accumulator vocabularies mirror the core registries
(`ExpressionSpec`, `AccumulatorSpec`): registering a new operator means
adding it to the matching list here — the exact-match failure is the
reminder.

## Running

- `bun run test:completions` (from the repo root), or `bun run test` here.
- This package is **excluded from the root `test:ci`** (and therefore from
  the pre-commit hook) because it intentionally fails while the known leaks
  exist. CI runs it as a dedicated advisory (non-gating) job.

Note: object-literal keys that need quoting come back with the quotes in
the entry name (`'"shipping.city"'`); string-literal completions come back
bare (`"shipping.city"`).
