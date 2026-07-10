import {
  Document,
  OmitNeverValues,
  Prettify,
  UnionToIntersection,
  MergeNested,
  IsPlainObject,
} from "../utils/objects";
import { PassThrough, PipeSafeError, UnknownFieldError } from "../utils/errors";
import { HasOperatorKey } from "../utils/dispatch";
import { ExpandDottedKey, IsDottedKey } from "../utils/paths";
import { NoDollarString, WithoutDollar } from "../utils/strings";
import {
  FieldReference,
  GetFieldTypeWithoutArrays,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import {
  FieldSelector,
  FieldSelectorKeys,
  GetFieldTypeOrError,
} from "../elements/fieldSelector";
import { ValidateNestedValue } from "../elements/validation";
import { InferVariableReference, SystemVariable } from "../elements/literals";

/**
 * $project stage query type
 *
 * Supports:
 * - Field inclusion/exclusion: { field: 1 } or { field: true } to include, { field: 0 } or { field: false } to exclude
 * - Field renaming: { newName: "$oldName" }
 * - Expression operators: { newField: { $size: "$arrayField" } }
 * - Nested reshaping: { nested: { a: "$field1", b: "$field2" } }
 */
// The value union for a $project assignment.
type ProjectValue<Schema extends Document> =
  // Inclusion/exclusion flags (1/0/true/false). `number | boolean` IS the
  // literal set: TS normalizes `1 | 0 | number` to `number` and
  // `true | false` to `boolean` at union creation, so spelling the
  // literals adds nothing. The wide types are also required on their own
  // terms — MongoDB treats any nonzero number as inclusion, so a
  // `number`/`boolean`-typed VARIABLE is a valid projection value even
  // though its literal can't be known at compile time (rejecting it
  // would go through the deep value union and surface a spurious
  // TS2589).
  | number
  | boolean
  // FINITE `$`-string arms (mirrors stages/set.ts): the schema-derived
  // FieldReference union plus the enumerated SYSTEM_VARIABLES — both
  // autocomplete, neither absorbs the other, and neither leaks
  // String.prototype into object-literal completions (finite literals are
  // primitive-flagged). A wide `` `$${string}` `` template here is provably
  // unusable: it erases the ref literals from completions, and its
  // `` & {} `` spelling leaks String.prototype. A typo'd ref or unlisted
  // `$$var` now rejects at the constraint with a "Did you mean" hint.
  | FieldReference<Schema>
  | SystemVariable
  // Plain string values are valid MongoDB literal assignments in $project
  // (only numeric/boolean literals require $literal).
  | NoDollarString
  // Nested object replacement AND expression shapes. Expression<Schema>
  // below is AUTOCOMPLETE-ONLY: Document subsumes every object for
  // checking — do not "fix" acceptance bugs by editing it.
  | Document
  | Expression<Schema>;

/**
 * `$project` query. The `[key: string]` index signature keeps arbitrary new
 * keys (including brand-new dotted paths) legal AND governs value acceptance
 * (`ProjectValue<Schema>`); the intersected `FieldSelectorKeys` is an
 * AUTOCOMPLETE-ONLY hint that surfaces the schema's existing field selectors
 * as key suggestions. Its value type is `unknown` on purpose — key
 * completion does not depend on it, and instantiating the deep
 * `ProjectValue<Schema>` union once per field-selector key blows the
 * whole-project typecheck from seconds to a multi-minute hang.
 */
export type ProjectQuery<Schema extends Document> = {
  [key: string]: ProjectValue<Schema>;
} & FieldSelectorKeys<Schema, unknown>;

// ---------------------------------------------------------------------------
// Projection mode — THE single pair. `_id` is skipped in both directions
// because it is MongoDB's sole exception to the no-mixing rule
// (`{_id: 0, name: 1}` and `{_id: 1, name: 0}` are both valid). Both
// ValidateProjectQuery and ResolveProjectOutput default their `Inc`/`Exc`
// parameters from this pair; the second computation is an alias-cache hit.
// Uses `true extends {...}[keyof P]` (existential check) so a
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

/**
 * The mixed-mode brand, spelled once: fired at the call site by
 * ValidateProjectQuery and at the resolver by ResolveProjectOutput for the
 * same user error.
 */
type MixedProjectionError =
  PipeSafeError<`Stage '$project' cannot mix inclusion 1/true and exclusion 0/false.`>;

/**
 * Per-key project re-check: `never` = valid (key is filtered out by the
 * wrapper). Inclusion/exclusion flags exit in one arm (the dominant
 * projection value); unknown keys carrying a flag brand; every other value
 * goes through the shared nested-validation kernel.
 */
type ValidateProjectKey<Schema extends Document, P, K extends keyof P> =
  [P[K]] extends [number | boolean] ?
    string extends keyof Schema ?
      never // unknown-key detection is meaningless on a wide schema
    : K extends FieldSelector<Schema> ? never
    : UnknownFieldError<K & string>
  : ValidateNestedValue<Schema, P[K]>;

type ValidateProjectQueryKeys<Schema extends Document, P> = OmitNeverValues<{
  [K in keyof P]: ValidateProjectKey<Schema, P, K>;
}>;

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
 * `Inc`/`Exc` default from the NonId mode pair above; direct 2-arg
 * annotation works thanks to the defaults.
 */
export type ValidateProjectQuery<
  Schema extends Document,
  P,
  Inc extends boolean = HasInclusionsNonId<P>,
  Exc extends boolean = HasExclusionsNonId<P>,
> =
  // Wide-QUERY guard: on constraint failure TS re-instantiates this wrapper
  // with P = ProjectQuery<Schema> (index signature ⇒ `keyof P` includes
  // string); validating the wide value unions would brand valid keys and
  // overflow depth on top of the real error. The mixed-mode check below is
  // deliberately NOT schema-guarded — it is schema-independent, so it fires
  // on index-signature schemas too (the per-key/value checks guard
  // themselves).
  string extends keyof P ? {}
  : Inc extends true ?
    Exc extends true ?
      // Mixed mode: brand each non-_id exclusion VALUE so TS reports
      // TS2322 ("Type 0 is not assignable to PipeSafeError<...>") at
      // the offending 0/false rather than TS2353 on a valid key. Key-
      // filtered: only the offending exclusion keys survive.
      OmitNeverValues<{
        [K in keyof P]: K extends "_id" ? never
        : P[K] extends 0 | false ? MixedProjectionError
        : never;
      }>
    : ValidateProjectQueryKeys<Schema, P>
  : ValidateProjectQueryKeys<Schema, P>;

// Helper: Resolve nested objects with field references and expressions.
// InferNestedFieldReference key-dispatches expressions internally, so no
// separate expression structural check is needed.
type ResolveNestedProjection<Schema extends Document, Obj extends Document> = {
  [K in keyof Obj]: InferNestedFieldReference<Schema, Obj[K]>;
};

// Helper: Resolve a single field value (handles both regular and dotted keys)
type ResolveFieldValue<Schema extends Document, Value, Key extends string> =
  Value extends 0 | false ?
    // Exclusion - return never (field is excluded). Intentional: `never`
    // here means "the field is dropped from the output", which is correct.
    never
  : [Value] extends [number | boolean] ?
    // Inclusion — literal 1/true, or a WIDENED number/boolean (MongoDB:
    // any nonzero number includes; compile time can't know the runtime
    // value, so degrade to inclusion). If the key isn't on the schema,
    // surface a branded error rather than silently producing `never`.
    // GetFieldTypeOrError handles dotted and plain keys alike and brands
    // unknown paths - a bare GetFieldType here silently produced a `never`
    // leaf for unknown DOTTED keys, contradicting this comment.
    GetFieldTypeOrError<Schema, Key>
  : Value extends `$$${string}` ?
    // `$$`-variable reference ($$NOW, $$ROOT, "$$ROOT.name", ...) — must
    // dispatch BEFORE the single-`$` ref arm below, which would misread
    // "$$NOW" as a field path "$NOW" and brand it. $$REMOVE's `never`
    // drops the field, which IS its semantics; unresolvable names degrade
    // to `unknown` (validation owns rejection).
    InferVariableReference<Schema, Value & string>
  : Value extends `$${string}` ?
    // Field reference — a `$`-string check is far cheaper than FieldReference
    // union membership; unknown paths brand via GetFieldTypeWithoutArrays.
    GetFieldTypeWithoutArrays<Schema, WithoutDollar<Value & string>>
  : HasOperatorKey<Value> extends true ?
    // $-keyed object = expression
    InferExpression<Schema, Value>
  : Value extends Document ?
    // Nested object - recursively resolve field references and expressions within it
    ResolveNestedProjection<Schema, Value>
  : [Value] extends [string] ?
    Value // plain-string literal assignment (valid MongoDB; $-refs handled above)
  : PipeSafeError<`Stage '$project' requires a valid projection value for field '${Key}'.`>;

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
      GetFieldTypeOrError<Schema, K & string>
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
        // KEPT so ResolveFieldValue brands them ("Stage '$project' requires
        // a valid projection value for field...") instead of silently
        // dropping the key — exclusion
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
    // `$`-string / Document checks are far cheaper per key than full
    // FieldReference/Expression union membership tests; ResolveFieldValue
    // does the real dispatch and brands invalid values.
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
 * `Inc`/`Exc` default from the NonId mode pair. The `_id`-skipping
 * semantics mean MongoDB's `_id` exception applies in both directions:
 * `{_id: 1, name: 0}` dispatches to exclusion mode. Genuine non-`_id`
 * mixing brands rather than silently dropping the conflicting key.
 *
 * No `Query extends ProjectQuery<Schema>` re-check: Pipeline.project's
 * parameter position already validated the query, and re-proving it would
 * cost a full mapped-type instantiation per call.
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
      MixedProjectionError
    : // Inclusion mode
      ResolveInclusionMode<Schema, Query>
  : Exc extends true ?
    // Exclusion mode
    ResolveExclusionMode<Schema, Query>
  : // Default: inclusion mode (when only field references or nested objects)
    ResolveInclusionMode<Schema, Query>
>;
