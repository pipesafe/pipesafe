export type Document = Record<string, any>;

export type DollarPrefixed<T extends string> = `$${T}`;
export type WithoutDollar<T extends string> =
  T extends `$${infer U}` ? U : never;

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type ExpandDottedKey<Key extends string, Value> =
  Key extends `${infer Left}.${infer Rest}` ?
    { [K in Left]: ExpandDottedKey<Rest, Value> }
  : { [K in Key]: Value };

// Stage 2.1: Batch expand - process 2 dot levels at a time to reduce recursion depth
// This reduces depth by ~50% for deeply nested paths (e.g., "a.b.c.d" -> 2 recursions instead of 4)
export type ExpandDottedKeyBatched<Key extends string, Value> =
  Key extends `${infer First}.${infer Second}.${infer Rest}` ?
    Rest extends (
      `${string}.${string}` // More dots exist
    ) ?
      {
        [K in First]: {
          [K2 in Second]: ExpandDottedKeyBatched<Rest, Value>;
        };
      }
    : { [K in First]: { [K2 in Second]: { [K3 in Rest]: Value } } } // Base case: last 3 segments
  : Key extends `${infer First}.${infer Rest}` ?
    { [K in First]: { [K2 in Rest]: Value } } // Base case: last 2 segments
  : { [K in Key]: Value }; // No dots

// Version that preserves optionality - makes top-level key optional if Value includes undefined
export type ExpandDottedKeyPreservingOptional<Key extends string, Value> =
  Key extends `${infer Left}.${infer Rest}` ?
    undefined extends Value ?
      { [K in Left]?: ExpandDottedKey<Rest, Exclude<Value, undefined>> }
    : { [K in Left]: ExpandDottedKey<Rest, Value> }
  : undefined extends Value ? { [K in Key]?: Exclude<Value, undefined> }
  : { [K in Key]: Value };

export type Join<K extends string, P extends string> =
  P extends "" ? K : `${K}.${P}`;

type IsTuple<A extends unknown[]> = number extends A["length"] ? false : true;
type TupleIndex<A extends unknown[]> = Exclude<keyof A, keyof any[]>;
export type IndexStr<A extends unknown[]> =
  IsTuple<A> extends true ? `${TupleIndex<A> & number}` : `${number}`;

export type NonExpandableTypes = Function | { _bsontype: string } | Date;

// Define alphanumeric characters
export type SpecialCharacters = " " | "." | "," | ";";
export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type LowerAlphabet =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
export type UpperAlphabet = Uppercase<LowerAlphabet>;
export type Alphabet = LowerAlphabet | UpperAlphabet;
export type NoDollarString = `${Alphabet | Digit}${string}` & {};

export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I
  : never;

export type FlattenToNested<T> = Prettify<
  UnionToIntersection<
    {
      [K in keyof T]: ExpandDottedKey<K & string, T[K]>;
    }[keyof T]
  >
>;

// Check if a type has any dotted keys (keys containing a dot)
export type HasDottedKeys<T> =
  {
    [K in keyof T]: K extends string ?
      K extends `${string}.${string}` ?
        true
      : never
    : never;
  }[keyof T] extends never ?
    false
  : true;

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

// Given a type T, removes keys that are string-literal "dot syntax" keys (e.g. "a.b").
// Only keeps the non-dotted (plain) keys.
export type RemoveDottedKeys<T> = {
  [K in keyof T as K extends string ?
    K extends `${string}.${string}` ?
      never
    : K
  : K]: T[K];
};

// Filter out undefined from a union type
type ExcludeUndefined<T> = T extends undefined ? never : T;

// Check if a type contains any non-never values (recursively)
// Used to determine if $$REMOVE operations are setting any actual values
type HasNonNeverValue<T> =
  T extends object ?
    { [K in keyof T]: HasNonNeverValue<T[K]> }[keyof T] extends false ?
      false
    : true
  : T extends never ? false
  : true;

// Expands all dotted keys into nested objects, UnionToIntersection merges them together.
// Note: We exclude undefined to handle optional properties correctly, as TypeScript
// adds | undefined to indexed access of optional properties
// Stage 2.1: Use batched expansion to reduce recursion depth
export type ExpandAllDotted<T> = UnionToIntersection<
  ExcludeUndefined<
    {
      [K in keyof T]: K extends string ? ExpandDottedKeyBatched<K, T[K]>
      : unknown;
    }[keyof T]
  >
>;

// Stage 2.3: Replace UnionToIntersection with Iterative Merge
// Alternative approach: Merge expanded objects iteratively
// Note: We still use UnionToIntersection internally for correctness
// because MergeNested is order-dependent and produces different results

// Merge expanded objects iteratively
// Issue: Iterative MergeNested produces different results than UnionToIntersection
// because MergeNested order matters for optional fields and nested structures
// Solution: Use UnionToIntersection within iterative merge to maintain correctness
type MergeExpandedObjectsIterative<T> =
  T extends Record<string, any> ?
    {
      [K in keyof T]: T[K];
    } extends infer ExpandedMap ?
      ExpandedMap extends Record<string, any> ?
        // Extract all expanded objects as a union and use UnionToIntersection
        // This merges all objects simultaneously (commutative) like original ExpandAllDotted
        UnionToIntersection<ExcludeUndefined<ExpandedMap[keyof ExpandedMap]>>
      : never
    : never
  : {};

// Iterative version of ExpandAllDotted (Stage 2.3)
// Replaces UnionToIntersection with iterative MergeNested
type ExpandAllDottedIterative<T> =
  {
    [K in keyof T]: K extends string ? ExpandDottedKeyBatched<K, T[K]> : never;
  } extends infer Expanded ?
    Expanded extends Record<string, any> ?
      MergeExpandedObjectsIterative<Expanded>
    : never
  : never;

// Extract the remaining path after the first segment (e.g., "a.b.c" -> "b.c")
// type ExtractRemainingPath<K> = K extends `${string}.${infer Rest}`
//   ? Rest
//   : never;

// Get all unique top-level keys from dotted keys
// Note: We exclude undefined because optional keys add undefined to the indexed type
type GetTopLevelKeys<T> = Exclude<
  {
    [K in keyof T]: K extends string ?
      K extends `${infer First}.${string}` ?
        First
      : never
    : never;
  }[keyof T],
  undefined
>;

// Check if any key starting with TopKey is required (doesn't have undefined)
// Returns true if at least one required key exists, false if all are optional
type HasAnyRequiredSubPath<T, TopKey extends string> =
  true extends (
    Exclude<
      {
        [K in keyof T]: K extends `${TopKey}.${string}` ?
          undefined extends T[K] ?
            false // This key is optional
          : true // This key is required
        : false;
      }[keyof T],
      undefined // Exclude undefined that comes from optional keys in mapped types
    >
  ) ?
    true // At least one required key found
  : false; // No required keys found

// A top-level key should be optional if ALL its sub-paths are optional
type AreAllSubPathsOptional<T, TopKey extends string> =
  HasAnyRequiredSubPath<T, TopKey> extends true ? false : true;

// Split GetTopLevelKeys into optional and required
type OptionalTopLevelKeys<T> = {
  [K in GetTopLevelKeys<T>]: AreAllSubPathsOptional<T, K> extends true ? K
  : never;
}[GetTopLevelKeys<T>];

type RequiredTopLevelKeys<T> = {
  [K in GetTopLevelKeys<T>]: AreAllSubPathsOptional<T, K> extends true ? never
  : K;
}[GetTopLevelKeys<T>];

// Get all non-dotted keys from T
type NonDottedKeys<T> = {
  [K in keyof T]: K extends string ?
    K extends `${string}.${string}` ?
      never
    : K
  : K;
}[keyof T];

// Build nested structure for a specific top-level key, preserving optionality
type BuildNestedForKey<T, TopKey extends string> = UnionToIntersection<
  ExcludeUndefined<
    {
      [K in keyof T]: K extends `${TopKey}.${infer Rest}` ?
        undefined extends T[K] ?
          ExpandDottedKeyPreservingOptional<Rest, T[K]>
        : ExpandDottedKey<Rest, T[K]>
      : never;
    }[keyof T]
  >
>;

// Version that groups by top-level key first, then builds nested structure
export type ExpandAllDottedPreservingOptional<T> = {
  // Handle non-dotted keys
  [K in NonDottedKeys<T> as K extends string ? K : never]: T[K];
} & {
  // Handle required top-level dotted keys
  [TopKey in RequiredTopLevelKeys<T>]: BuildNestedForKey<T, TopKey>;
} & {
  // Handle optional top-level dotted keys
  [TopKey in OptionalTopLevelKeys<T>]?: BuildNestedForKey<T, TopKey>;
};

// Merge plain objects deeply (does NOT merge arrays/Date/etc.)
export type IsPlainObject<T> =
  T extends object ?
    T extends any[] ? false
    : T extends Function ? false
    : T extends Date ? false
    : T extends RegExp ? false
    : T extends { _bsontype: string } ? false
    : true
  : false;

// Helper to determine merge result for a key when both A and B have it
// Extracted to reduce conditional nesting depth in MergeNested
type MergeKeyValue<AVal, BVal> =
  [BVal] extends [never] ?
    never // If B has never, preserve it (for $$REMOVE)
  : IsPlainObject<AVal> extends true ?
    IsPlainObject<BVal> extends true ?
      MergeNested<AVal, BVal> // both plain objects: recurse
    : BVal
  : BVal; // B wins if not both objects (B has new value)

// Helper to check if two types have the same keys (cheaper than full extends check)
// This is a fast heuristic: if keyof A === keyof B, types might be identical
type HaveSameKeys<A, B> =
  keyof A extends keyof B ?
    keyof B extends keyof A ?
      true
    : false
  : false;

// Stage 3.1: Optimize MergeNested Recursion
// Conditional early exit: only check for identical types when keys match
// This avoids expensive bidirectional extends check when keys differ
// Key insight: If keys differ, types can't be identical, so skip the check
export type MergeNested<A, B> =
  HaveSameKeys<A, B> extends true ?
    // Keys match - check if types are identical (worth the check)
    [A] extends [B] ?
      [B] extends [A] ?
        A // Early exit: types are exactly identical
      : Prettify<{
          [K in keyof A | keyof B]: K extends keyof B ?
            K extends keyof A ?
              MergeKeyValue<A[K], B[K]>
            : B[K]
          : K extends keyof A ? A[K]
          : never;
        }>
    : Prettify<{
        [K in keyof A | keyof B]: K extends keyof B ?
          K extends keyof A ?
            MergeKeyValue<A[K], B[K]>
          : B[K]
        : K extends keyof A ? A[K]
        : never;
      }>
  : // Keys differ - skip expensive check, go straight to merge
    Prettify<{
      [K in keyof A | keyof B]: K extends keyof B ?
        K extends keyof A ?
          MergeKeyValue<A[K], B[K]>
        : B[K]
      : K extends keyof A ? A[K]
      : never;
    }>;

// Flattens dot-nested keys (like "a.b": x) into nested object structure, merging as necessary.
// E.g. { a: { b: "first" }, "a.c": "last" } => { a: { b: "first", c: "last" }}
// Main utility:
// 1. Expands any dotted keys in T to their nested structure,
// 2. Merges expanded structure into original object (non-dotted keys win for those keys),
// 3. Removes original dotted keys from output.
//
// Stage 1.2: Type aliases for intermediate steps - REMOVED
// Analysis: Type aliases don't create separate cache entries - TypeScript caches by type identity.
// Benchmark comparison showed no measurable difference:
//   - With aliases: +1,086,995 instantiations, 320ms
//   - Without aliases: +1,087,985 instantiations, 295ms
// Conclusion: Aliases provide NO caching benefit - kept only for code organization.
// Removed to simplify code - types are inlined directly in FlattenDotSet.

// Stage 2.4: Two-Phase Processing - separate dotted and non-dotted keys for better optimization
// This allows optimizing each path independently
type SeparateKeys<T> = {
  dotted: Pick<T, Extract<keyof T, `${string}.${string}`>>;
  nonDotted: Omit<T, Extract<keyof T, `${string}.${string}`>>;
};

// Stage 2.3: Testing iterative merge to replace UnionToIntersection
// Fixed: MergeExpandedObjectsIterative now uses UnionToIntersection internally
// This maintains correctness while still using iterative expansion structure
export type FlattenDotSet<T> =
  SeparateKeys<T> extends infer Separated ?
    Separated extends { dotted: infer D; nonDotted: infer N } ?
      Prettify<
        N & // Non-dotted keys pass through
          RemoveDottedKeys<
            MergeNested<
              {},
              ExpandAllDottedIterative<D> // Stage 2.3: Uses UnionToIntersection internally for correctness
            >
          >
      >
    : never
  : never;

// Helpers for applying $set updates while preserving optionality semantics

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
// Recursively removes never fields from nested objects
//
// Stage 3.2: Optimize RemoveNeverFields Recursion
// Added early exit for non-object types to reduce unnecessary processing
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
//
// OPTIMIZATION ATTEMPT 2: Conditional reordering
// Only reorder if keys actually differ from schema order
// This avoids expensive operation when keys already match
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

// Stage 3.1: Selective Path Processing - only process schema paths that are ancestors of dotted keys
// This optimization reduces type instantiation depth when schema has many nested objects
// but only a few dotted keys in the query
export type ApplySetUpdates<Schema extends Document, Updates extends Document> =
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
