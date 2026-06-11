/**
 * Backwards-compatibility exports — THE ONLY FILE deprecated aliases may
 * live in.
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
 * Note: there is deliberately no alias for `ResolveCountOutput`'s arity
 * change (`<FieldName>` → `<Schema, FieldName>`): one exported name cannot
 * carry both signatures, so that change shipped as a documented break.
 */

import type { MergeQuery } from "./stages/merge";
import type { Document } from "./utils/objects";

/**
 * @deprecated Renamed to `MergeQuery` (stage trio naming convention).
 * Will be removed in v1.0.0.
 */
export type MergeOptions<TOutput extends Document> = MergeQuery<TOutput>;
