import { FieldPath } from "../elements/fieldReference";
import { Document, Prettify } from "../utils/core";

export type UnsetQuery<Schema extends Document> =
  | FieldPath<Schema>
  | FieldPath<Schema>[];

// Direct implementation to remove fields from schema without going through $set pipeline
// This avoids unnecessary type instantiations and depth

// Optimization: Batch process nested paths - process 2 levels at a time to reduce recursion depth
// Similar to ExpandDottedKeyBatched for set operations (reduces depth by ~50% for deeply nested paths)
type RemoveFieldPathBatched<Schema extends Document, Path extends string> =
  Path extends `${infer First}.${infer Second}.${infer Rest}` ?
    // Process 2 levels at once if more levels exist
    Rest extends `${string}.${string}` ?
      First extends keyof Schema ?
        Exclude<Schema[First], undefined> extends infer NestedValue ?
          NestedValue extends Document ?
            {
              [K in keyof Schema]: K extends First ?
                undefined extends Schema[K] ?
                  | RemoveFieldPathBatched<NestedValue, `${Second}.${Rest}`>
                  | undefined
                : RemoveFieldPathBatched<NestedValue, `${Second}.${Rest}`>
              : Schema[K];
            }
          : Schema
        : Schema
      : Schema
    : // Base case: last 3 segments - process all at once (no more recursion)
    First extends keyof Schema ?
      Exclude<Schema[First], undefined> extends infer NestedValue ?
        NestedValue extends Document ?
          Second extends keyof NestedValue ?
            Exclude<NestedValue[Second], undefined> extends infer DeepValue ?
              DeepValue extends Document ?
                Rest extends keyof DeepValue ?
                  {
                    [K in keyof Schema]: K extends First ?
                      undefined extends Schema[K] ?
                        | {
                            [K2 in keyof NestedValue]: K2 extends Second ?
                              undefined extends NestedValue[K2] ?
                                Omit<DeepValue, Rest> | undefined
                              : Omit<DeepValue, Rest>
                            : NestedValue[K2];
                          }
                        | undefined
                      : {
                          [K2 in keyof NestedValue]: K2 extends Second ?
                            undefined extends NestedValue[K2] ?
                              Omit<DeepValue, Rest> | undefined
                            : Omit<DeepValue, Rest>
                          : NestedValue[K2];
                        }
                    : Schema[K];
                  }
                : Schema
              : Schema
            : Schema
          : Schema
        : Schema
      : Schema
    : Schema
  : Path extends `${infer First}.${infer Rest}` ?
    // Base case: 2 segments - process both at once (no more recursion)
    First extends keyof Schema ?
      Exclude<Schema[First], undefined> extends infer NestedValue ?
        NestedValue extends Document ?
          Rest extends keyof NestedValue ?
            {
              [K in keyof Schema]: K extends First ?
                undefined extends Schema[K] ?
                  Omit<NestedValue, Rest> | undefined
                : Omit<NestedValue, Rest>
              : Schema[K];
            }
          : Schema
        : Schema
      : Schema
    : Schema
  : // Top-level field - remove it directly
  Path extends keyof Schema ? Omit<Schema, Path>
  : Schema;

// Remove a single field path from schema (uses batched processing for nested paths)
type RemoveFieldPath<
  Schema extends Document,
  Path extends string,
> = RemoveFieldPathBatched<Schema, Path>;

// Helper: Check if all paths are top-level (no dots) for early exit optimization
type AllTopLevelPaths<Paths extends readonly string[]> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      First extends `${string}.${string}` ?
        false // Found a dotted path
      : Rest extends readonly string[] ? AllTopLevelPaths<Rest>
      : true
    : true
  : true;

// Helper: Extract all top-level keys as a union type for batched Omit
type ExtractTopLevelKeys<Paths extends readonly string[]> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      First extends `${string}.${string}` ?
        // Dotted path - skip it
        Rest extends readonly string[] ?
          ExtractTopLevelKeys<Rest>
        : never
      : // Top-level key - include it
      Rest extends readonly string[] ? First | ExtractTopLevelKeys<Rest>
      : First
    : Rest extends readonly string[] ? ExtractTopLevelKeys<Rest>
    : never
  : never;

// Helper: Extract all nested paths under a specific parent key
type ExtractNestedPathsForParent<
  Parent extends string,
  Paths extends readonly string[],
> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      First extends `${Parent}.${infer SubPath}` ?
        Rest extends readonly string[] ?
          [SubPath, ...ExtractNestedPathsForParent<Parent, Rest>]
        : [SubPath]
      : Rest extends readonly string[] ?
        ExtractNestedPathsForParent<Parent, Rest>
      : []
    : Rest extends readonly string[] ? ExtractNestedPathsForParent<Parent, Rest>
    : []
  : [];

// Helper: Check if a key has nested paths to remove
type HasNestedPaths<Key extends string, Paths extends readonly string[]> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      First extends `${Key}.${string}` ? true
      : Rest extends readonly string[] ? HasNestedPaths<Key, Rest>
      : false
    : false
  : false;

// Optimization: Batch remove nested paths grouped by parent
// Processes all nested removals under the same parent key together
type BatchRemoveNestedByParent<
  Schema extends Document,
  Paths extends readonly string[],
> = {
  [K in keyof Schema]: HasNestedPaths<K & string, Paths> extends true ?
    // This key has nested removals - batch process them
    Schema[K] extends Document ?
      undefined extends Schema[K] ?
        // Optional field - preserve optionality
        | RemoveFieldPaths<
            Exclude<Schema[K], undefined>,
            ExtractNestedPathsForParent<K & string, Paths>
          >
        | undefined
      : RemoveFieldPaths<
          Schema[K],
          ExtractNestedPathsForParent<K & string, Paths>
        >
    : Schema[K]
  : Schema[K];
};

// Remove multiple field paths from schema
// Optimization: Batch Omit for top-level paths, batch by parent for nested paths
// This avoids deep recursion by grouping nested paths by their parent key
type RemoveFieldPaths<
  Schema extends Document,
  Paths extends readonly string[],
> =
  AllTopLevelPaths<Paths> extends true ?
    // All paths are top-level - extract all keys and batch Omit in one operation
    ExtractTopLevelKeys<Paths> extends infer KeysToRemove ?
      [KeysToRemove] extends [never] ?
        // No keys to remove
        Schema
      : [KeysToRemove] extends [keyof Schema] ?
        // All keys are valid - batch Omit them all at once
        // Use tuple check [KeysToRemove] extends [keyof Schema] to avoid distribution
        Omit<Schema, KeysToRemove>
      : Schema
    : Schema
  : // Has nested paths - separate top-level and nested, process separately
  ExtractTopLevelKeys<Paths> extends infer TopLevelKeys ?
    // First remove top-level keys
    [TopLevelKeys] extends [never] ?
      // No top-level keys - process nested paths grouped by parent
      BatchRemoveNestedByParent<Schema, Paths>
    : [TopLevelKeys] extends [keyof Schema] ?
      // Remove top-level keys first, then process nested paths
      BatchRemoveNestedByParent<Omit<Schema, TopLevelKeys>, Paths>
    : BatchRemoveNestedByParent<Schema, Paths>
  : Schema;

// Preserve optionality when removing nested fields from optional parents
// Optimization: Avoid Prettify wrapper to reduce depth
// Key insight: If original field was optional, preserve its optionality when removing nested fields
type PreserveOptionality<Schema extends Document, Result extends Document> = {
  // Required fields from result
  [K in keyof Result as K extends keyof Schema ?
    undefined extends Schema[K] ?
      never // Optional fields handled below
    : K
  : K]: Result[K];
} & {
  // Optional fields from result (preserve optionality)
  [K in keyof Result as K extends keyof Schema ?
    undefined extends Schema[K] ?
      K
    : never
  : never]?: Result[K];
};

export type ResolveUnsetOutput<Query, Schema extends Document> = Prettify<
  Query extends UnsetQuery<Schema> ?
    Query extends string ?
      // Single field path
      RemoveFieldPath<Schema, Query>
    : Query extends readonly string[] ?
      // Array of field paths
      AllTopLevelPaths<Query> extends true ?
        // All top-level - batched Omit result
        RemoveFieldPaths<Schema, Query>
      : // Has nested paths - PreserveOptionality needed to flatten intersection
        PreserveOptionality<Schema, RemoveFieldPaths<Schema, Query>>
    : never
  : never
>;
