import {
  Document,
  Prettify,
  ExpandDottedKey,
  UnionToIntersection,
  MergeNested,
  IsPlainObject,
} from "../utils/core";
import {
  FieldReference,
  InferFieldReference,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import { GetFieldType } from "../elements/fieldSelector";

// ============================================================================
// Expression Operators for $project Stage
// ============================================================================

/**
 * Union of all expression operators for $project
 * Uses Expression which includes array expressions ($concatArrays, $size) and date expressions ($dateToString)
 * Extend this as we add more operators (e.g., string ops, math ops, etc.)
 */
export type ProjectExpression<Schema extends Document> = Expression<Schema>;

/**
 * Infer the result type of a project expression
 * Delegates to InferExpression which handles all expression operators
 */
export type InferProjectExpression<
  Schema extends Document,
  Expr,
> = InferExpression<Schema, Expr>;

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
    | ProjectExpression<Schema>
    | Document; // For nested object replacement
};

// Helper: Check if a value is an inclusion (1 or true)
type IsInclusion<T> = T extends 1 | true ? true : false;

// Helper: Check if a value is an exclusion (0 or false)
type IsExclusion<T> = T extends 0 | false ? true : false;

// Helper: Check if projection is in inclusion mode (has any 1 or true values)
type HasInclusions<Query extends Record<string, unknown>> =
  {
    [K in keyof Query]: IsInclusion<Query[K]>;
  }[keyof Query] extends true ?
    true
  : false;

// Helper: Check if projection is in exclusion mode (has any 0 or false values, excluding _id)
type HasExclusions<Query extends Record<string, unknown>> =
  {
    [K in keyof Query]: K extends "_id" ? false : IsExclusion<Query[K]>;
  }[keyof Query] extends true ?
    true
  : false;

// Helper: Check if a key contains dots (is a dotted key)
type IsDottedKey<Key extends string> =
  Key extends `${string}.${string}` ? true : false;

// Helper: Resolve nested objects with field references and expressions
// Uses InferNestedFieldReference for field references, but also handles ProjectExpression
type ResolveNestedProjection<Schema extends Document, Obj extends Document> = {
  [K in keyof Obj]: Obj[K] extends ProjectExpression<Schema> ?
    // Expression operator - infer the expression result type
    InferProjectExpression<Schema, Obj[K]>
  : // Use InferNestedFieldReference for everything else (field refs, nested objects, literals)
    InferNestedFieldReference<Schema, Obj[K]>;
};

// Helper: Resolve a single field value (handles both regular and dotted keys)
type ResolveFieldValue<Schema extends Document, Value, Key extends string> =
  Value extends 1 | true ?
    // Inclusion - get field type from schema
    IsDottedKey<Key> extends true ?
      // Dotted key - get nested field type
      GetFieldType<Schema, Key>
    : Key extends keyof Schema ? Schema[Key]
    : never
  : Value extends 0 | false ?
    // Exclusion - return never (field is excluded)
    never
  : Value extends FieldReference<Schema> ?
    // Field reference - infer the referenced field type
    InferFieldReference<Schema, Value>
  : Value extends ProjectExpression<Schema> ?
    // Expression operator - infer the expression result type
    InferProjectExpression<Schema, Value>
  : Value extends Document ?
    // Nested object - recursively resolve field references and expressions within it
    ResolveNestedProjection<Schema, Value>
  : never;

// Helper: Create flat map of dotted keys to their types (only include keys with 1/true values)
type DottedKeyFlatMap<
  Schema extends Document,
  Query extends ProjectQuery<Schema>,
> = Prettify<{
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
type ExpandDottedProjection<
  Schema extends Document,
  Query extends ProjectQuery<Schema>,
> =
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
type NonDottedKeys<Query extends Record<string, unknown>> = {
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
type ResolveInclusionMode<
  Schema extends Document,
  Query extends ProjectQuery<Schema>,
> = Prettify<
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
        // Include non-dotted fields specified in query
        [K in keyof NonDottedKeys<Query> as K extends "_id" ? never
        : Query[K] extends 1 | true ? K
        : Query[K] extends FieldReference<Schema> ? K
        : Query[K] extends ProjectExpression<Schema> ? K
        : Query[K] extends Document ? K
        : never]: ResolveFieldValue<Schema, Query[K], K & string>;
      } & ExpandDottedProjection<Schema, Query>
    >
  >
>;

// Helper: Resolve exclusion mode projection
type ResolveExclusionMode<
  Schema extends Document,
  Query extends ProjectQuery<Schema>,
> = Prettify<
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
      : Query[K] extends FieldReference<Schema> ?
        never // Field references create new fields, don't exclude
      : Query[K] extends Document ?
        never // Nested objects create new fields
      : K
    : K]: Schema[K];
  } & {
    // Add fields from field references, expressions, and nested objects
    [K in keyof Query as K extends "_id" ? never
    : Query[K] extends FieldReference<Schema> ? K
    : Query[K] extends ProjectExpression<Schema> ? K
    : Query[K] extends Document ? K
    : never]: ResolveFieldValue<Schema, Query[K], K & string>;
  }
>;

/**
 * Resolves the output schema type for a $project stage
 */
export type ResolveProjectOutput<Query, Schema extends Document> =
  Query extends ProjectQuery<Schema> ?
    HasInclusions<Query> extends true ?
      // Inclusion mode
      ResolveInclusionMode<Schema, Query>
    : HasExclusions<Query> extends true ?
      // Exclusion mode
      ResolveExclusionMode<Schema, Query>
    : // Default: inclusion mode (when only field references or nested objects)
      ResolveInclusionMode<Schema, Query>
  : never;
