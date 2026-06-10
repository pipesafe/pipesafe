import { InferNestedFieldReference } from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import { AnyLiteral } from "../elements/literals";
import { PassThrough } from "../utils/errors";
import {
  Document,
  ExcludeUndefined,
  IsPlainObject,
  Prettify,
  UnionToIntersection,
} from "../utils/objects";
import { FlattenDotSet, HasDottedKeys } from "../utils/paths";

export type RemoveNever<T> = Prettify<{
  [K in keyof T as [T[K]] extends [never] ? never : K]: T[K];
}>;

/**
 * Transformation expressions - aggregation operators that transform values
 * These are not literals, but expressions that compute new values
 * Uses Expression which includes array expressions and date expressions
 */
export type TransformationExpression<Schema extends Document> =
  Expression<Schema>;
// Future: Add more transformation operators here (e.g., string ops, math ops, etc.)

export type SetQuery<Schema extends Document> = {
  [k: string]:
    | AnyLiteral<Schema>
    | TransformationExpression<Schema>
    | "$$REMOVE";
};

export type ResolveSetQueryValueType<
  Schema extends Document,
  Query,
  Key extends keyof Query,
> =
  Query[Key] extends "$$REMOVE" ? never
  : Query[Key] extends Expression<Schema> ?
    InferExpression<Schema, Query[Key]> // Handle expression operators
  : InferNestedFieldReference<Schema, Query[Key]>; // Fall back to literal/field ref handling

// ============================================================================
// $set update machinery — applies a flattened update object to the schema
// while preserving optionality semantics. Moved here from utils/core.ts:
// set.ts is its only consumer (docs/type-standardisation-plan.md §3.6).
// ============================================================================

// Extract ancestor paths from dotted keys
// Example: "a.b.c" -> ["a", "a.b"]
// This helps us only process relevant schema paths
type ExtractAncestorPaths<T extends string> =
  T extends `${infer First}.${infer Rest}` ?
    Rest extends `${string}.${string}` ?
      First | `${First}.${ExtractAncestorPaths<Rest>}`
    : First
  : never;

// Get all ancestor paths from all dotted keys in a type
type GetAllAncestorPaths<T> = {
  [K in keyof T]: K extends string ?
    K extends `${string}.${string}` ?
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

type MergeSetPlainObjects<Base, Updates extends Document> = Prettify<
  RemoveNeverFields<
    PreservedBaseFields<Base, Updates> & {
      // Required update keys: new fields or fields that were required, or optional fields being set to actual values
      [K in keyof Updates as K extends keyof ExcludeUndefined<Base> ?
        undefined extends ExcludeUndefined<Base>[K] ?
          HasNonNeverValue<Updates[K]> extends false ?
            never
          : K
        : K
      : K]-?: MergedUpdateValue<
        K extends keyof ExcludeUndefined<Base> ? ExcludeUndefined<Base>[K]
        : never,
        Updates[K]
      >;
    } & {
      // Optional update keys: originally optional fields being set to only removals
      [K in keyof Updates as K extends keyof ExcludeUndefined<Base> ?
        undefined extends ExcludeUndefined<Base>[K] ?
          HasNonNeverValue<Updates[K]> extends false ?
            K
          : never
        : never
      : never]?: MergedUpdateValue<
        K extends keyof ExcludeUndefined<Base> ? ExcludeUndefined<Base>[K]
        : never,
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

// Determine which update keys should be required after $set
// A key is required if:
// - It's a new field (not in Schema), OR
// - It was originally required in Schema, OR
// - It was originally optional but we're setting actual values (not just $$REMOVE)
//
// NOTE: When Schema is a union type, accessing non-existent properties via Schema[K]
// returns `any`. We need to use K extends keyof Schema to safely distinguish new fields.
type RequiredUpdateKeys<Schema extends Document, Updates extends Document> = {
  [K in keyof Updates]: K extends keyof Schema ?
    undefined extends Schema[K] ?
      HasNonNeverValue<Updates[K]> extends false ?
        never // Originally optional and only removals -> optional
      : K // Originally optional but setting values -> required
    : K // Originally required -> required
  : K; // New field (doesn't exist in Schema) -> required
}[keyof Updates];

// Determine which update keys should be optional after $set
// A key is optional only if:
// - It was originally optional in Schema, AND
// - We're only removing fields (all values are never after processing)
type OptionalUpdateKeys<Schema extends Document, Updates extends Document> = {
  [K in keyof Updates]: K extends keyof Schema ?
    undefined extends Schema[K] ?
      HasNonNeverValue<Updates[K]> extends false ?
        K // Originally optional and only removals -> optional
      : never
    : never
  : never;
}[keyof Updates];

// Reorder keys in Output to match the order in Schema
// This ensures key ordering matches expected schema order for type equality checks
// Note: TypeScript's Equal type should be order-independent, but this helps ensure
// consistent ordering for better type inference and debugging
// IMPORTANT: Preserves required/optional status from Output, not Schema
// Conditional: only reorders if keys actually differ from schema order.
type ReorderKeysToMatchSchema<
  Schema extends Document,
  Output extends Document,
> =
  keyof Output extends keyof Schema ?
    keyof Schema extends keyof Output ?
      Output // Keys match exactly - no reordering needed
    : {
      // Keys differ - need reordering
      [K in keyof Output as K extends keyof Schema ? K : never]: Output[K];
    } & {
      [K in keyof Output as K extends keyof Schema ? never : K]: Output[K];
    } extends infer Reordered ?
      Prettify<Reordered>
    : never
  : {
    // Keys differ - need reordering
    [K in keyof Output as K extends keyof Schema ? K : never]: Output[K];
  } & {
    [K in keyof Output as K extends keyof Schema ? never : K]: Output[K];
  } extends infer Reordered ?
    Prettify<Reordered>
  : never;

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

// The old `Query extends SetQuery<Schema>` structural re-check is gone
// (spec 3.4): Pipeline.set's generic constraint already validated the query
// at the parameter position; re-proving it here instantiated the full
// SetQuery mapped type (AnyLiteral + Expression unions) per call.
export type ResolveSetOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  HasDottedKeys<ResolveSetInlineSchema<Schema, Query>> extends true ?
    // Has dotted keys - flatten them into nested structure first
    Prettify<
      ApplySetUpdates<
        Schema,
        FlattenDotSet<ResolveSetInlineSchema<Schema, Query>>
      >
    >
  : // No dotted keys - skip FlattenDotSet entirely (Early Exit optimization)
    Prettify<ApplySetUpdates<Schema, ResolveSetInlineSchema<Schema, Query>>>
>;
