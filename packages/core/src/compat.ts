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
 * Note: the spec originally also planned a compat alias for
 * `ResolveCountOutput`'s arity change (`<FieldName>` → `<Schema, FieldName>`),
 * but one exported name cannot carry both signatures — that change ships as a
 * documented breaking change instead (see the spec's §3.7 amendment).
 */

import type { MergeQuery } from "./stages/merge";
import type { Document } from "./utils/objects";

/**
 * @deprecated Renamed to `MergeQuery` (stage trio naming convention,
 * docs/type-standardisation-plan.md §3.1). Will be removed in v1.0.0.
 */
export type MergeOptions<TOutput extends Document> = MergeQuery<TOutput>;
