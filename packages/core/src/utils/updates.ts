/**
 * Dotted-key update application — THE shared merge kernel for stages that
 * write a value at a (possibly dotted) path while preserving the schema's
 * optionality semantics: `$set` (stages/set.ts) applies its whole update
 * object through it, and `$lookup` (stages/lookup.ts) applies a dotted
 * `as` path, which MongoDB treats exactly like a $set of that path.
 * Lives in utils because stages must not import each other; everything
 * here depends only on utils/objects and utils/paths.
 *
 * Entry point: `ApplySetUpdates<Schema, Updates>` — `Updates` must already
 * be dot-EXPANDED (callers run `FlattenDotSet` first; see
 * ResolveSetOutputInner / ResolveLookupOutput for the early-exit split
 * that skips the flatten for non-dotted keys).
 */

import {
  Document,
  ExcludeUndefined,
  HaveSameKeys,
  IsPlainObject,
  Prettify,
} from "./objects";

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
  HaveSameKeys<Output, Schema> extends true ?
    Output // Keys match exactly - no reordering needed
  : ReorderedKeys<Schema, Output>;

// The module contract (header) guarantees `Updates` is already dot-EXPANDED
// — callers run FlattenDotSet first — so there is exactly one merge path.
// (A "Selective" dotted-key branch used to live here; it was unreachable
// under the contract AND computed a union instead of the merged
// intersection — deleted rather than fixed.)
export type ApplySetUpdates<
  Schema extends Document,
  Updates extends Document,
> = ReorderKeysToMatchSchema<Schema, ApplySetUpdatesStandard<Schema, Updates>>;

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
