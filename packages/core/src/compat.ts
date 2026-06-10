/**
 * Backwards-compatibility exports — THE ONLY FILE deprecated aliases may
 * live in (docs/type-standardisation-plan.md §3.7).
 *
 * Rules:
 * - Each alias carries `@deprecated` JSDoc naming its replacement and the
 *   removal milestone (v1.0.0).
 * - `index.ts` re-exports from here so the public surface is unchanged.
 * - Nothing inside the package may import from this file (enforced by the
 *   `no-restricted-imports` ESLint rule) — internal code uses the new names.
 * - Removal at the next major: delete this file, drop its `index.ts`
 *   re-export line, add a `major` changeset listing the removed names.
 *
 * Currently empty — the two expected entries (the old single-parameter
 * `ResolveCountOutput<FieldName>` form and the `MergeOptions` name) arrive
 * with the Phase 3 renames.
 */

export {};
