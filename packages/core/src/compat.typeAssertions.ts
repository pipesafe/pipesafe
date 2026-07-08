/**
 * Compat-alias conformance assertions.
 *
 * Every deprecated alias in compat.ts must stay IDENTICAL to its
 * replacement until removal at the next major. Imports go through
 * "./index" (the public surface) rather than "./compat" directly, so the
 * internal import ban on compat.ts stays intact.
 */

import type { MergeOptions, MergeQuery } from "./index";
import { Assert, Equal } from "./utils/tests";

type _TestDoc = { _id: string; total: number };

type _MergeOptionsAliasIntact = Assert<
  Equal<MergeOptions<_TestDoc>, MergeQuery<_TestDoc>>
>;

export type { _MergeOptionsAliasIntact };
