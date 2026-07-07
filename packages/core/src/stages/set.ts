import { InferNestedFieldReference } from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral, ExpressionShaped } from "../elements/literals";
import { ValidateNestedValue } from "../elements/validation";
import { PassThrough } from "../utils/errors";
import {
  Document,
  ExcludeUndefined,
  IsPlainObject,
  OmitNeverValues,
  Prettify,
  UnionToIntersection,
} from "../utils/objects";
import { FlattenDotSet, HasDottedKeys, IsDottedKey } from "../utils/paths";

/**
 * `$`-shaped values (`$`-strings, `$`-keyed objects) are accepted
 * STRUCTURALLY here and re-checked by `ValidateSetQuery` (§3.8 rule 2/6).
 * Rejecting them through the deep `AnyLiteral | Expression` union instead
 * accumulates relation depth on the shared call-checking stack and surfaced
 * spurious statement-level TS2589s next to the real error (plan §7.3
 * addendum).
 *
 * `Expression<Schema>` and `"$$REMOVE"` are AUTOCOMPLETE-ONLY members:
 * for checking they are subsumed by `ExpressionShaped` and `` `$${string}` ``
 * respectively (every valid expression is expression-shaped; "$$REMOVE" is
 * a $-string), so neither can decide acceptance — do not "fix" acceptance
 * bugs by editing them.
 */
export type SetQuery<Schema extends Document> = {
  [k: string]:
    | AnyLiteral<Schema>
    | Expression<Schema>
    | `$${string}`
    | ExpressionShaped
    | "$$REMOVE";
};

/**
 * Key-filtered validation wrapper for `Pipeline.set` (§3.8 rule 5):
 * OmitNeverValues drops valid keys, so a fully-valid query validates
 * against `{}` and the `$set: Q & ValidateSetQuery<Schema, Q>` intersection
 * costs nothing on the happy path; only offending keys survive, mapped to
 * the kernel's replacement so TS2322 lands at the offending value. The
 * `string extends keyof Q` guard skips validation entirely when Q is not a
 * literal query (the constraint-failure fallback instantiates the wrapper
 * with SetQuery<Schema> itself — walking its wide value unions would brand
 * valid keys and overflow the instantiation depth on top of the real
 * error). `"$$REMOVE"` needs no special case: the kernel accepts the
 * `$$`-system-variable namespace.
 */
export type ValidateSetQuery<Schema extends Document, Q> =
  // Schema wide-guard: a degenerate/index-signature schema (e.g. from an
  // upstream inference gap) cannot be meaningfully validated against —
  // skip rather than brand valid queries (forgiving, like the registry).
  string extends keyof Schema ? {}
  : string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateNestedValue<Schema, Q[K]>;
    }>;

export type ResolveSetQueryValueType<
  Schema extends Document,
  Query,
  Key extends keyof Query,
> =
  Query[Key] extends "$$REMOVE" ? never
  : // InferNestedFieldReference key-dispatches expressions internally; a
    // structural `extends Expression<Schema>` pre-check here would
    // instantiate the full expression union per value.
    InferNestedFieldReference<Schema, Query[Key]>;

// ============================================================================
// $set update machinery — applies a flattened update object to the schema
// while preserving optionality semantics. Lives here because set.ts is its
// only consumer.
// ============================================================================

// Extract ancestor paths from dotted keys
// Example: "a.b.c" -> ["a", "a.b"]
// This helps us only process relevant schema paths
type ExtractAncestorPaths<T extends string> =
  T extends `${infer First}.${infer Rest}` ?
    IsDottedKey<Rest> extends true ?
      First | `${First}.${ExtractAncestorPaths<Rest>}`
    : First
  : never;

// Get all ancestor paths from all dotted keys in a type
type GetAllAncestorPaths<T> = {
  [K in keyof T]: K extends string ?
    IsDottedKey<K> extends true ?
      ExtractAncestorPaths<K>
    : never
  : never;
}[keyof T];

// Extract a single path from schema (recursive helper)
type ExtractSinglePath<Schema extends Document, Path extends string> =
  Path extends `${infer First}.${infer Rest}` ?
    First extends keyof Schema ?
      Rest extends string ?
        Schema[First] extends infer V ?
          V extends Document ?
            { [K in First]: ExtractSinglePath<V, Rest> }
          : { [K in First]: V }
        : never
      : First extends keyof Schema ? { [K in First]: Schema[K] }
      : {}
    : {}
  : Path extends keyof Schema ? { [K in Path]: Schema[K] }
  : {};

// Extract all relevant schema paths for dotted keys (handles union of paths)
// Merges all extracted paths into a single object
type ExtractRelevantSchemaPaths<
  Schema extends Document,
  Updates extends Document,
> =
  GetAllAncestorPaths<Updates> extends infer Paths ?
    Paths extends string ?
      // Union of paths - extract each and merge
      UnionToIntersection<ExtractSinglePath<Schema, Paths>>
    : {}
  : {};

// Check if a type contains any non-never values (recursively)
// Used to determine if $$REMOVE operations are setting any actual values
type HasNonNeverValue<T> =
  T extends object ?
    { [K in keyof T]: HasNonNeverValue<T[K]> }[keyof T] extends false ?
      false
    : true
  : T extends never ? false
  : true;

type PlainObjectOrNever<T> =
  T extends object ?
    IsPlainObject<T> extends true ?
      T
    : never
  : never;

type IncludesUndefined<T> = undefined extends T ? true : false;

type MaybeAddUndefined<T, Flag> = Flag extends true ? T | undefined : T;

// Helper to make all properties in T optional
type MakeOptional<T> = {
  [K in keyof T]?: T[K] | undefined;
};

// Helper to compute preserved base fields (fields not being updated)
// Extracted to reduce nesting depth in MergeSetPlainObjects
type PreservedBaseFields<Base, Updates extends Document> =
  [Base] extends [never] ?
    {} // Base is never (new field), just return an empty object
  : PlainObjectOrNever<ExcludeUndefined<Base>> extends infer BaseObject ?
    BaseObject extends Document ?
      // If Base is optional and we're setting actual values (not just $$REMOVE),
      // make preserved fields optional since we're doing a partial update
      undefined extends Base ?
        HasNonNeverValue<Updates> extends true ?
          MakeOptional<Omit<BaseObject, keyof Updates>>
        : Omit<BaseObject, keyof Updates>
      : Omit<BaseObject, keyof Updates>
    : {}
  : {};

// BaseObj caches the undefined-stripped base used throughout the body.
type MergeSetPlainObjects<
  Base,
  Updates extends Document,
  BaseObj = ExcludeUndefined<Base>,
> = Prettify<
  RemoveNeverFields<
    PreservedBaseFields<Base, Updates> & {
      // Required update keys: new fields or fields that were required, or optional fields being set to actual values
      [K in keyof Updates as K extends keyof BaseObj ?
        undefined extends BaseObj[K] ?
          HasNonNeverValue<Updates[K]> extends false ?
            never
          : K
        : K
      : K]-?: MergedUpdateValue<
        K extends keyof BaseObj ? BaseObj[K] : never,
        Updates[K]
      >;
    } & {
      // Optional update keys: originally optional fields being set to only removals
      [K in keyof Updates as K extends keyof BaseObj ?
        undefined extends BaseObj[K] ?
          HasNonNeverValue<Updates[K]> extends false ?
            K
          : never
        : never
      : never]?: MergedUpdateValue<
        K extends keyof BaseObj ? BaseObj[K] : never,
        Updates[K]
      >;
    }
  >
>;

// Helper to compute merged value for a single update key
// Extracted to reduce repetition and simplify recursion
type MergedUpdateValue<BaseValue, UpdateValue> = MaybeAddUndefined<
  MergeSetValue<BaseValue, UpdateValue>,
  IncludesUndefined<UpdateValue>
>;

type MergeSetValue<BaseValue, UpdateValue> =
  // If BaseValue is never (new field), preserve UpdateValue as-is including optionality
  [BaseValue] extends [never] ? UpdateValue
  : PlainObjectOrNever<ExcludeUndefined<UpdateValue>> extends (
    infer UpdateObject
  ) ?
    [UpdateObject] extends [never] ? UpdateValue
    : UpdateObject extends Document ?
      MergeSetPlainObjects<BaseValue, UpdateObject> // Pass BaseValue with undefined
    : UpdateValue
  : UpdateValue;

// Helper to filter out keys with never values from a type
// Handles both required never fields and optional never fields (never | undefined)
// Recursively removes never fields from nested objects, with early exits for
// arrays and non-object types.
type RemoveNeverFields<T> =
  T extends object ?
    T extends any[] ?
      T // Early exit: arrays are preserved as-is
    : {
        [K in keyof T as [T[K]] extends [never] ? never
        : [Exclude<T[K], undefined>] extends [never] ? never
        : K]: T[K] extends object ?
          T[K] extends infer U ?
            U extends any[] ?
              T[K] // Preserve arrays
            : IsPlainObject<U> extends true ?
              RemoveNeverFields<U> // Recursively remove never fields from nested objects
            : T[K]
          : T[K]
        : T[K];
      }
  : T; // Early exit: non-object types pass through unchanged

// One walk classifies every update key; the required/optional key sets
// both derive from the (alias-cached) classification.
//
// A key is required if it's a new field (not in Schema), was originally
// required, or was originally optional but is being set to actual values
// (not just $$REMOVE). It is optional only if originally optional AND only
// removals are applied.
//
// NOTE: When Schema is a union type, accessing non-existent properties via
// Schema[K] returns `any` — K extends keyof Schema distinguishes new fields.
type ClassifyUpdateKeys<Schema extends Document, Updates extends Document> = {
  [K in keyof Updates]: K extends keyof Schema ?
    undefined extends Schema[K] ?
      HasNonNeverValue<Updates[K]> extends false ?
        "optional" // Originally optional and only removals
      : "required" // Originally optional but setting values
    : "required" // Originally required
  : "required"; // New field (doesn't exist in Schema)
};

type RequiredUpdateKeys<
  Schema extends Document,
  Updates extends Document,
  C = ClassifyUpdateKeys<Schema, Updates>,
> = { [K in keyof C]: C[K] extends "required" ? K : never }[keyof C];

type OptionalUpdateKeys<
  Schema extends Document,
  Updates extends Document,
  C = ClassifyUpdateKeys<Schema, Updates>,
> = { [K in keyof C]: C[K] extends "optional" ? K : never }[keyof C];

// Reorder keys in Output to match the order in Schema
// This ensures key ordering matches expected schema order for type equality checks
// Note: TypeScript's Equal type should be order-independent, but this helps ensure
// consistent ordering for better type inference and debugging
// IMPORTANT: Preserves required/optional status from Output, not Schema
// Conditional: only reorders if keys actually differ from schema order.
// Schema-known keys first, then the rest.
type ReorderedKeys<Schema extends Document, Output extends Document> = Prettify<
  {
    [K in keyof Output as K extends keyof Schema ? K : never]: Output[K];
  } & {
    [K in keyof Output as K extends keyof Schema ? never : K]: Output[K];
  }
>;

type ReorderKeysToMatchSchema<
  Schema extends Document,
  Output extends Document,
> =
  keyof Output extends keyof Schema ?
    keyof Schema extends keyof Output ?
      Output // Keys match exactly - no reordering needed
    : ReorderedKeys<Schema, Output>
  : ReorderedKeys<Schema, Output>;

// Selective path processing — only process schema paths that are ancestors of
// dotted keys. Reduces type instantiation depth when the schema has many
// nested objects but the query has only a few dotted keys.
type ApplySetUpdates<Schema extends Document, Updates extends Document> =
  HasDottedKeys<Updates> extends true ?
    // Has dotted keys - use selective schema extraction
    ReorderKeysToMatchSchema<Schema, ApplySetUpdatesSelective<Schema, Updates>>
  : // No dotted keys - use standard processing (no optimization needed)
    ReorderKeysToMatchSchema<Schema, ApplySetUpdatesStandard<Schema, Updates>>;

// Standard processing for non-dotted keys (no optimization needed)
type ApplySetUpdatesStandard<
  Schema extends Document,
  Updates extends Document,
> = Prettify<
  RemoveNeverFields<
    Pick<Schema, Exclude<keyof Schema, keyof Updates>> & {
      // Required update keys
      [K in RequiredUpdateKeys<Schema, Updates>]-?: MergeSetValue<
        K extends keyof Schema ? Schema[K] : never,
        Updates[K]
      >;
    } & {
      // Optional update keys (when only doing $$REMOVE operations on nested fields)
      [K in OptionalUpdateKeys<Schema, Updates>]?: MergeSetValue<
        K extends keyof Schema ? Schema[K] : never,
        Updates[K]
      >;
    }
  >
>;

// Selective processing - only merge with relevant schema paths
type ApplySetUpdatesSelective<
  Schema extends Document,
  Updates extends Document,
> =
  ExtractRelevantSchemaPaths<Schema, Updates> extends infer RelevantSchema ?
    RelevantSchema extends Document ?
      Prettify<
        RemoveNeverFields<
          // Preserve non-updated keys from schema (including non-relevant paths)
          Pick<Schema, Exclude<keyof Schema, keyof Updates>> & {
            // Required update keys - only merge with relevant schema paths
            [K in RequiredUpdateKeys<Schema, Updates>]-?: MergeSetValue<
              K extends keyof RelevantSchema ? RelevantSchema[K]
              : K extends keyof Schema ? Schema[K]
              : never,
              Updates[K]
            >;
          } & {
            // Optional update keys
            [K in OptionalUpdateKeys<Schema, Updates>]?: MergeSetValue<
              K extends keyof RelevantSchema ? RelevantSchema[K]
              : K extends keyof Schema ? Schema[K]
              : never,
              Updates[K]
            >;
          }
        >
      >
    : ApplySetUpdatesStandard<Schema, Updates>
  : ApplySetUpdatesStandard<Schema, Updates>;

// COLLECTION SCHEMA // SET STAGE ==> OUTPUT SCHEMA
// { a?: string | undefined } // { $set: { a: 'hello' }} ==> { a: string }
// { a?: { b?: string | undefined } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello' } }
// { a?: { b: string, c: string } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello', c?: string | undefined }}

// Don't use RemoveNever here - let ApplySetUpdates handle never values
export type ResolveSetInlineSchema<Schema extends Document, Query> = {
  [Key in keyof Query]: ResolveSetQueryValueType<Schema, Query, Key>;
};

// Inner resolver with the inline schema hoisted to a parameter. Sits INSIDE
// the PassThrough happy path so an upstream error never pays for it.
type ResolveSetOutputInner<Schema extends Document, Inline extends Document> =
  HasDottedKeys<Inline> extends true ?
    // Has dotted keys - flatten them into nested structure first
    Prettify<ApplySetUpdates<Schema, FlattenDotSet<Inline>>>
  : // No dotted keys - skip FlattenDotSet entirely (Early Exit optimization)
    Prettify<ApplySetUpdates<Schema, Inline>>;

// No `Query extends SetQuery<Schema>` re-check: Pipeline.set's generic
// constraint already validated the query, and re-proving it would
// instantiate the full SetQuery mapped type per call.
export type ResolveSetOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  ResolveSetOutputInner<Schema, ResolveSetInlineSchema<Schema, Query>>
>;
