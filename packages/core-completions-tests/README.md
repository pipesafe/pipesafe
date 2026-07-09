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

Known-bad positions keep their exact ideal assertion but are marked
`it.fails` with a `KNOWN BAD` comment naming the offending type: vitest
passes them while the defect exists and FAILS them the moment the type is
fixed — remove the `.fails` modifier then to promote the test. One position
remains known-bad: set string-value field-reference completions (the
non-absorption trick provably trades the missing suggestions for a
String.prototype leak in sibling object positions — see stages/set.ts).
**Do not weaken an ideal list to make a test pass** — fix the type, or if
the ideal itself was wrong, change the list in a reviewed commit.

The ideal operator/accumulator vocabularies mirror the core registries
(`ExpressionSpec`, `AccumulatorSpec`): registering a new operator means
adding it to the matching list here — the exact-match failure is the
reminder.

## Running

Part of the ordinary root vitest run — `bun run test:ci` (CI's single test
job and the pre-commit hook) picks this package up like any other. To run
just this suite: `bun run test` inside this package, or
`bunx vitest run packages/core-completions-tests` from the root.

Note: object-literal keys that need quoting come back with the quotes in
the entry name (`'"shipping.city"'`); string-literal completions come back
bare (`"shipping.city"`).
