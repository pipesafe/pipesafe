import { FieldPath } from "../elements/fieldReference";
import { Document, Prettify } from "../utils/objects";
import { IsDottedKey, SplitPath } from "../utils/paths";
import { PassThrough } from "../utils/errors";

export type UnsetQuery<Schema extends Document> =
  | FieldPath<Schema>
  | FieldPath<Schema>[];

// Direct implementation to remove fields from schema without going through $set pipeline
// This avoids unnecessary type instantiations and depth

// Walk pre-split path segments and remove the leaf, preserving optionality at
// every level (spec §3.5 Pattern C: parsing is done tail-recursively by
// SplitPath; this fold descends one structural level per segment, replacing
// the old hand-batched 2-levels-per-recursion implementation).
type RemoveAtSegments<Schema extends Document, Segs extends readonly string[]> =
  Segs extends [infer Only extends string] ?
    Only extends keyof Schema ?
      Omit<Schema, Only>
    : Schema
  : Segs extends [infer Head extends string, ...infer Rest extends string[]] ?
    Head extends keyof Schema ?
      Exclude<Schema[Head], undefined> extends infer NestedValue ?
        NestedValue extends Document ?
          {
            [K in keyof Schema]: K extends Head ?
              undefined extends Schema[K] ?
                RemoveAtSegments<NestedValue, Rest> | undefined
              : RemoveAtSegments<NestedValue, Rest>
            : Schema[K];
          }
        : Schema
      : Schema
    : Schema
  : Schema;

// Remove a single field path from schema
type RemoveFieldPath<Schema extends Document, Path extends string> =
  Path extends keyof Schema ? Omit<Schema, Path>
  : IsDottedKey<Path> extends true ? RemoveAtSegments<Schema, SplitPath<Path>>
  : Schema;

// Helper: Check if all paths are top-level (no dots) for early exit optimization
type AllTopLevelPaths<Paths extends readonly string[]> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      IsDottedKey<First> extends true ?
        false // Found a dotted path
      : Rest extends readonly string[] ? AllTopLevelPaths<Rest>
      : true
    : true
  : true;

// Helper: Extract all top-level keys as a union type for batched Omit
type ExtractTopLevelKeys<Paths extends readonly string[]> =
  Paths extends readonly [infer First, ...infer Rest] ?
    First extends string ?
      IsDottedKey<First> extends true ?
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
// This avoids deep recursion by grouping nested paths by their parent key.
// TopOnly and Keys are hoisted cache parameters (spec §3.5 Pattern B):
// previously AllTopLevelPaths was evaluated both here and by the caller, and
// ExtractTopLevelKeys via two separate `extends infer` branches.
type RemoveFieldPaths<
  Schema extends Document,
  Paths extends readonly string[],
  TopOnly = AllTopLevelPaths<Paths>,
  Keys = ExtractTopLevelKeys<Paths>,
> =
  TopOnly extends true ?
    // All paths are top-level - batch Omit them in one operation
    [Keys] extends [never] ?
      // No keys to remove
      Schema
    : [Keys] extends [keyof Schema] ?
      // All keys are valid - batch Omit them all at once
      // Use tuple check [Keys] extends [keyof Schema] to avoid distribution
      Omit<Schema, Keys & keyof Schema>
    : Schema
  : // Has nested paths - remove top-level keys first, then process nested
  [Keys] extends [never] ? BatchRemoveNestedByParent<Schema, Paths>
  : [Keys] extends [keyof Schema] ?
    BatchRemoveNestedByParent<Omit<Schema, Keys & keyof Schema>, Paths>
  : BatchRemoveNestedByParent<Schema, Paths>;

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

// The old outer `Query extends UnsetQuery<Schema>` re-check is gone (spec
// 3.4): it re-enumerated FieldPath<Schema> per call even though the method's
// parameter position already validated the query. The cheap string/array
// narrowing below is all the body needs.
export type ResolveUnsetOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  Prettify<
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
  >
>;
