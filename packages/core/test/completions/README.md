# IDE autocomplete tests

Editors don't invent completion lists — VS Code, JetBrains, and every
`typescript-language-server` client ask tsserver, and tsserver answers via
`LanguageService.getCompletionsAtPosition`. Driving that API directly in a
vitest suite therefore tests exactly what a user sees on Ctrl+Space, minus
client-side fuzzy filtering.

## How it works

`harness.ts` builds one language service over the real
`packages/core/tsconfig.json` program plus a single **virtual** file inside
`src/` (never written to disk). Each probe:

1. takes a full source snippet containing exactly one `‸` cursor marker,
2. swaps it into the virtual file (bumping its version, so only that file
   re-parses — probes after the first cost ~50–300 ms),
3. asks for completions at the marker's offset and returns the entries.

```ts
const probe = tester.completionsAt(FIXTURE + `orders.match({ ‸ });`);
probe.names; //=> ["_id", "status", …, "$and", "$or", …]
probe.isMemberCompletion; //=> true
```

## What to assert

- **`names`** — the entries the IDE lists. Pin exact sorted lists for tight
  surfaces (sort keys, unwind paths); use `arrayContaining` / `not.toContain`
  for open ones.
- **`isMemberCompletion`** — `true` means TS produced a _contextual_ key
  list. `false` inside an object literal means autocomplete is effectively
  broken there: the editor falls back to ~1000 global identifiers.

Note: object-literal keys that need quoting come back with the quotes in the
name (`'"shipping.city"'`); string-literal completions come back bare
(`"shipping.city"`).

## Conventions

- `it(...)` pins behavior that must not regress.
- `it.fails(...)` documents a known-bad position — the assertion states the
  DESIRED completions. When the underlying type is fixed, the test flips to
  failing; remove the `.fails` modifier to promote it to a regression guard.

The two failure classes currently documented:

1. **Structural members leaking**: a bare `T` / `RegExp` / `Date` /
   `ObjectId` union arm is an object type, so TS offers its properties
   (`exec`, `getDate`, `toHexString`, …) as suggested keys.
2. **Too-broad strings**: `[key: string]` index signatures and
   `` `$${string}` `` template arms absorb the finite literal unions
   (`FieldReference<Schema>`), leaving the IDE with nothing to suggest.

These files are run by vitest (`bun run test:ci`) but are deliberately
outside `src/`, so they don't affect `typecheck:packages`, the published
build, or the instantiation budget.
