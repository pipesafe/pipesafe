import {
  Document,
  Prettify,
  UnionToIntersection,
  MergeNested,
  IsPlainObject,
} from "../utils/objects";
import { PassThrough, PipeSafeError } from "../utils/errors";
import { HasOperatorKey } from "../utils/dispatch";
import { ExpandDottedKey, IsDottedKey } from "../utils/paths";
import { WithoutDollar } from "../utils/strings";
import {
  FieldReference,
  GetFieldTypeWithoutArrays,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import { FieldSelector, GetFieldType } from "../elements/fieldSelector";

/**
 * $project stage query type
 *
 * Supports:
 * - Field inclusion/exclusion: { field: 1 } or { field: true } to include, { field: 0 } or { field: false } to exclude
 * - Field renaming: { newName: "$oldName" }
 * - Expression operators: { newField: { $size: "$arrayField" } }
 * - Nested reshaping: { nested: { a: "$field1", b: "$field2" } }
 */
export type ProjectQuery<Schema extends Document> = {
  [key: string]:
    | 1
    | 0
    | true
    | false
    | FieldReference<Schema>
    | Expression<Schema>
    | Document; // For nested object replacement
};

// ---------------------------------------------------------------------------
// Projection mode — THE single pair. `_id` is skipped in both directions
// because it is MongoDB's sole exception to the no-mixing rule
// (`{_id: 0, name: 1}` and `{_id: 1, name: 0}` are both valid). Both
// ValidateProjectQuery and ResolveProjectOutput default their `Inc`/`Exc`
// parameters from this pair (the second computation is an alias-cache hit;
// see spec §6). Uses `true extends {...}[keyof P]` (existential check) so a
// mixed query reports `true` for both — a naked indexed access would
// collapse `true | false` to `boolean` and hide the mix.
// ---------------------------------------------------------------------------

/** Does P have any non-_id key with an inclusion value (1 | true)? */
export type HasInclusionsNonId<P> =
  true extends (
    {
      [K in keyof P]: K extends "_id" ? never
      : P[K] extends 1 | true ? true
      : never;
    }[keyof P]
  ) ?
    true
  : false;

/** Does P have any non-_id key with an exclusion value (0 | false)? */
export type HasExclusionsNonId<P> =
  true extends (
    {
      [K in keyof P]: K extends "_id" ? never
      : P[K] extends 0 | false ? true
      : never;
    }[keyof P]
  ) ?
    true
  : false;

type ValidateProjectQueryKeys<Schema extends Document, P> = {
  [K in keyof P]: K extends FieldSelector<Schema> ? P[K]
  : P[K] extends 1 | 0 | true | false ?
    PipeSafeError<`Field '${K & string}' is not on the schema.`>
  : P[K];
};

/**
 * Validation wrapper for $project queries used at Pipeline.project's
 * parameter position. Two checks fire as branded `PipeSafeError`s at
 * the call site:
 *
 * 1. Mixed inclusion (1/true) and exclusion (0/false) on non-_id
 *    fields — MongoDB rejects this at runtime; only excluding `_id`
 *    while otherwise including is allowed.
 * 2. Inclusion of an unknown key — the user typed something that
 *    isn't a schema field. New-field-creation values (field refs,
 *    expressions, nested objects) on unknown keys still pass because
 *    that's the legitimate "rename / compute new field" case.
 *
 * Schema-known keys pass through unchanged so chained-stage inference
 * via ResolveProjectOutput<Schema, P> sees the literal P.
 *
 * `Inc`/`Exc` default from the consolidated NonId mode pair above; direct
 * 2-arg annotation works thanks to the defaults.
 *
 * Cost: ~3,600 instantiations once at baseline; zero per-stage marginal
 * cost for valid inputs (TS folds the mapped type when shape matches).
 * An `Exclude<keyof P, FieldSelector<Schema>> extends never ? P : ...`
 * early-exit was tried and adds ~600 instantiations without helping
 * the per-stage cost — left out.
 */
export type ValidateProjectQuery<
  Schema extends Document,
  P,
  Inc extends boolean = HasInclusionsNonId<P>,
  Exc extends boolean = HasExclusionsNonId<P>,
> =
  Inc extends true ?
    Exc extends true ?
      // Mixed mode: brand each non-_id exclusion VALUE so TS reports
      // TS2322 ("Type 0 is not assignable to PipeSafeError<...>") at
      // the offending 0/false rather than TS2353 on a valid key.
      {
        [K in keyof P]: K extends "_id" ? P[K]
        : P[K] extends 0 | false ?
          PipeSafeError<`Stage '$project' cannot mix inclusion 1/true and exclusion 0/false.`>
        : P[K];
      }
    : ValidateProjectQueryKeys<Schema, P>
  : ValidateProjectQueryKeys<Schema, P>;

// Helper: Resolve nested objects with field references and expressions.
// InferNestedFieldReference key-dispatches expressions internally (spec
// §3.4), so no separate ProjectExpression structural check is needed.
type ResolveNestedProjection<Schema extends Document, Obj extends Document> = {
  [K in keyof Obj]: InferNestedFieldReference<Schema, Obj[K]>;
};

// Helper: Resolve a single field value (handles both regular and dotted keys)
type ResolveFieldValue<Schema extends Document, Value, Key extends string> =
  Value extends 1 | true ?
    // Inclusion - get field type from schema. If the key isn't on the schema,
    // surface a branded error rather than silently producing `never` (which
    // would just drop the key from the output without any signal).
    IsDottedKey<Key> extends true ?
      // Dotted key - get nested field type
      GetFieldType<Schema, Key>
    : Key extends keyof Schema ? Schema[Key]
    : PipeSafeError<`Field '${Key}' is not on the schema.`>
  : Value extends 0 | false ?
    // Exclusion - return never (field is excluded). Intentional: `never`
    // here means "the field is dropped from the output", which is correct.
    never
  : Value extends `$${string}` ?
    // Field reference — cheap `$`-string dispatch (spec §3.4) instead of a
    // full FieldReference<Schema> union membership test; unknown paths brand
    // via GetFieldTypeWithoutArrays ("Field ... is not on the schema").
    GetFieldTypeWithoutArrays<Schema, WithoutDollar<Value & string>>
  : HasOperatorKey<Value> extends true ?
    // $-keyed object = expression (operator-key dispatch, spec §3.4)
    InferExpression<Schema, Value>
  : Value extends Document ?
    // Nested object - recursively resolve field references and expressions within it
    ResolveNestedProjection<Schema, Value>
  : PipeSafeError<`Invalid projection value for field '${Key}'.`>;

// Helper: Create flat map of dotted keys to their types (only include keys with 1/true values)
type DottedKeyFlatMap<Schema extends Document, Query> = Prettify<{
  [K in keyof Query as K extends string ?
    IsDottedKey<K> extends true ?
      Query[K] extends 1 | true ?
        K
      : never
    : never
  : never]: K extends keyof Query ?
    Query[K] extends 1 | true ?
      GetFieldType<Schema, K & string>
    : never
  : never;
}>;

// Helper: Expand all dotted keys and merge them
// Similar to FlattenDotSet pattern: expand first, then merge with MergeNested to deeply merge nested intersections
// Don't apply Prettify here - let MergeNested deeply merge nested intersections first
// Prettify will be applied at the ResolveInclusionMode level
type ExpandDottedProjection<Schema extends Document, Query> =
  keyof DottedKeyFlatMap<Schema, Query> extends never ? {}
  : MergeNested<
      {},
      UnionToIntersection<
        {
          [K in keyof DottedKeyFlatMap<Schema, Query>]: K extends string ?
            ExpandDottedKey<K, DottedKeyFlatMap<Schema, Query>[K]>
          : never;
        }[keyof DottedKeyFlatMap<Schema, Query>]
      >
    >;

// Helper: Extract non-dotted keys from query
type NonDottedKeys<Query> = {
  [K in keyof Query as K extends string ?
    IsDottedKey<K> extends true ?
      never
    : K
  : K]: Query[K];
};

// Helper: Deeply merge nested intersections recursively
// This ensures { user: { name } } & { user: { email } } becomes { user: { name, email } }
// Only merge plain objects, not Date, Array, etc.
type DeepMergeProjection<T> =
  T extends Record<string, any> ?
    IsPlainObject<T> extends true ?
      {
        [K in keyof T]: T[K] extends Record<string, any> ?
          IsPlainObject<T[K]> extends true ?
            DeepMergeProjection<T[K]>
          : T[K]
        : T[K];
      }
    : T
  : T;

// Helper: Resolve inclusion mode projection
// Use MergeNested to deeply merge nested intersections (e.g., { user: { name } } & { user: { email } })
type ResolveInclusionMode<Schema extends Document, Query> = Prettify<
  DeepMergeProjection<
    MergeNested<
      {},
      {
        // Always include _id unless explicitly excluded (only if _id exists in schema)
        [K in "_id" as K extends keyof Schema ?
          K extends keyof Query ?
            Query[K] extends 0 | false ?
              never
            : K
          : K // Include _id by default in inclusion mode
        : never]: Schema[K];
      } & {
        // Include non-dotted fields specified in query. Keys with invalid
        // values (not 1/true, ref, expression, or object) are deliberately
        // KEPT so ResolveFieldValue brands them ("Invalid projection value
        // for field ...") instead of silently dropping the key — exclusion
        // values can't reach the fallthrough because genuine mixing already
        // branded at dispatch.
        [K in keyof NonDottedKeys<Query> as K extends "_id" ? never
        : Query[K] extends 0 | false ? never
        : K]: ResolveFieldValue<Schema, Query[K], K & string>;
      } & ExpandDottedProjection<Schema, Query>
    >
  >
>;

// Helper: Resolve exclusion mode projection
type ResolveExclusionMode<Schema extends Document, Query> = Prettify<
  {
    // Always include _id unless explicitly excluded (only if _id exists in schema)
    [K in "_id" as K extends keyof Schema ?
      K extends keyof Query ?
        Query[K] extends 0 | false ?
          never
        : K
      : K // Include _id by default in exclusion mode
    : never]: Schema[K];
  } & {
    // Include all fields except those excluded
    [K in keyof Schema as K extends "_id" ? never
    : K extends keyof Query ?
      Query[K] extends 0 | false ? never
      : Query[K] extends `$${string}` ?
        never // Field references create new fields, don't exclude
      : Query[K] extends Document ?
        never // Nested objects (incl. expressions) create new fields
      : K
    : K]: Schema[K];
  } & {
    // Add fields from field references, expressions, and nested objects.
    // Cheap `$`-string / Document checks (spec §3.4) instead of full
    // FieldReference/Expression union membership tests per key —
    // ResolveFieldValue does the real dispatch and brands invalid values.
    [K in keyof Query as K extends "_id" ? never
    : Query[K] extends `$${string}` ? K
    : Query[K] extends Document ? K
    : never]: ResolveFieldValue<Schema, Query[K], K & string>;
  }
>;

/**
 * Resolves the output schema type for a $project stage. PassThrough forwards
 * a branded `PipeSafeError` Schema unchanged so upstream errors short-circuit.
 *
 * `Inc`/`Exc` default from the consolidated NonId mode pair (the method-
 * level hoist was dropped after the A/B comparison — the second computation
 * is an alias-cache hit; see spec §6). The
 * `_id`-skipping semantics mean MongoDB's `_id` exception applies in both
 * directions: `{_id: 1, name: 0}` correctly dispatches to exclusion mode
 * (previously this falsely branded as mixed). Genuine non-`_id` mixing
 * still brands rather than silently dropping the conflicting key.
 *
 * The old `Query extends ProjectQuery<Schema>` structural re-check is gone
 * (spec §3.4): Pipeline.project's parameter position already validated the
 * query; re-proving it here cost a full mapped-type instantiation per call.
 */
export type ResolveProjectOutput<
  Schema extends Document,
  Query,
  Inc extends boolean = HasInclusionsNonId<Query>,
  Exc extends boolean = HasExclusionsNonId<Query>,
> = PassThrough<
  Schema,
  Inc extends true ?
    Exc extends true ?
      PipeSafeError<`Stage '$project' cannot mix inclusion 1/true and exclusion 0/false.`>
    : // Inclusion mode
      ResolveInclusionMode<Schema, Query>
  : Exc extends true ?
    // Exclusion mode
    ResolveExclusionMode<Schema, Query>
  : // Default: inclusion mode (when only field references or nested objects)
    ResolveInclusionMode<Schema, Query>
>;
