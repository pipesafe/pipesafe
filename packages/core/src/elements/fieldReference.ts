import { Document, NonExpandableTypes, Prettify } from "../utils/objects";
import { Join, DollarPrefixed, WithoutDollar } from "../utils/strings";
import { PipeSafeError } from "../utils/errors";
import { HasOperatorKey } from "../utils/dispatch";
import { InferExpression } from "./expressions";

// Types related to field referencees
// These are used as part of values within expressions
// e.g. '$field' within the expression value here { $eq: ['$field', 'hello'] }
// They ARE prefixed with a $, and do NOT allow array item selection by index

export type FieldPath<T> =
  T extends (infer U)[] ? FieldPath<U>
  : T extends object ?
    T extends NonExpandableTypes ?
      never
    : {
        [K in Extract<keyof T, string>]:
          | K
          | (FieldPath<T[K]> extends infer P extends string ? Join<K, P>
            : never);
      }[Extract<keyof T, string>]
  : never;

export type FieldReference<T extends Document> = DollarPrefixed<FieldPath<T>>;

// NOTE (F7 asymmetry, deliberate): unknown paths brand with PipeSafeError
// here, while the field-selector twin (GetFieldType in fieldSelector.ts)
// resolves them to `never` — its `never` is load-bearing for union
// narrowing. FullPath is an accumulator parameter so recursion doesn't
// lose the original path for the error message (spec §3.5 precedent).
export type GetFieldTypeWithoutArrays<
  Schema,
  Path extends string,
  FullPath extends string = Path,
> =
  Schema extends (infer U)[] ? GetFieldTypeWithoutArrays<U, Path, FullPath>[]
  : // null/undefined branches of nullable unions silently fall through so
  // distributing over `T | null` doesn't leak the brand into a result
  // that's otherwise valid via the non-null branch.
  Schema extends null | undefined ? never
  : Path extends keyof Schema ?
    Schema[Path] // Direct property access
  : Path extends `${infer Head}.${infer Tail}` ?
    Head extends keyof Schema ?
      GetFieldTypeWithoutArrays<Schema[Head], Tail, FullPath> // Recurse into property
    : PipeSafeError<`Field '${FullPath}' is not on the schema.`>
  : Path extends string ?
    PipeSafeError<`Field '${FullPath}' is not on the schema.`>
  : never;

// Infer the type of a field at a given selector
// If traversing an array (which will always be without an index as these are not supported), return an array of the nested field type
export type InferFieldReference<
  Schema extends Document,
  Ref extends FieldReference<Schema>,
> = GetFieldTypeWithoutArrays<Schema, WithoutDollar<Ref>>;

/**
 * One ref→type map per schema (spec §3.5 Pattern B, the library's biggest
 * recomputation sink): every field reference mapped to its inferred type,
 * computed once per (distributed) schema and alias-cached — so the ~10
 * distinct target types used across operand helpers all filter the same
 * precomputed map instead of re-running InferFieldReference per target.
 *
 * NOTE: deliberately applied AFTER `Schema extends unknown` distribution in
 * the consumers below. A defaulted parameter (`M = SchemaRefTypeMap<Schema>`)
 * would be unsound: defaults substitute at instantiation, before the body's
 * conditional distributes a union schema, so the map would be built over the
 * whole union (per-path cross-member unions; brand-skip misfires).
 */
type SchemaRefTypeMap<Schema extends Document> = {
  [K in FieldReference<Schema>]: InferFieldReference<Schema, K>;
};

/** Filter a precomputed ref→type map down to refs assignable to T. */
type RefsInferringTo<M, DesiredType> = {
  [K in keyof M]: M[K] extends PipeSafeError<string> ?
    never // Skip branded errors — they only appear when K is widened past a valid path
  : NonNullable<M[K]> extends DesiredType ? K
  : never;
}[keyof M];

/** Lookup variant: reversed assignability, no NonNullable stripping. */
type RefsInferringToForLookup<M, DesiredType> = {
  [K in keyof M]: M[K] extends PipeSafeError<string> ? never
  : DesiredType extends M[K] ? K
  : never;
}[keyof M];

export type FieldPathsThatInferToForLookup<
  Schema extends Document,
  DesiredType,
> =
  FieldReferencesThatInferToForLookup<Schema, DesiredType> extends never ? never
  : FieldReferencesThatInferToForLookup<Schema, DesiredType> extends (
    `$${infer Path}`
  ) ?
    Path
  : never;

export type FieldReferencesThatInferToForLookup<
  Schema extends Document,
  DesiredType,
> =
  Schema extends unknown ?
    RefsInferringToForLookup<SchemaRefTypeMap<Schema>, DesiredType>
  : never;

export type FieldReferencesThatInferTo<Schema extends Document, DesiredType> =
  Schema extends unknown ?
    RefsInferringTo<SchemaRefTypeMap<Schema>, DesiredType>
  : never;

/**
 * Recursively infers and resolves all field references and expressions within a nested structure
 * @template Schema - The document schema to resolve field references against
 * @template Obj - The object/array/literal that may contain field references or expressions at any depth
 *
 * @example
 * InferNestedFieldReference<{ a: number }, { b: ['$a'] }> // { b: [number] }
 * InferNestedFieldReference<{ name: string, age: number }, { info: { userName: '$name', userAge: '$age' } }>
 * // { info: { userName: string, userAge: number } }
 * InferNestedFieldReference<{ count: number }, ['$count', 5, 'literal']> // [number, 5, 'literal']
 * InferNestedFieldReference<{ timestamp: Date }, { date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } } }>
 * // { date: string }
 */
export type InferNestedFieldReference<Schema extends Document, Obj> =
  Obj extends FieldReference<Schema> ? InferFieldReference<Schema, Obj>
  : Obj extends `$${string}` ? never
  : Obj extends unknown[] ? InferNestedFieldReferenceArray<Schema, Obj>
  : Obj extends object ?
    Obj extends NonExpandableTypes ? Obj
    : // Tier-2 operator-key dispatch (spec §3.4): only objects carrying a
    // `$`-prefixed key are candidates for expression inference — `$`-less
    // objects are nested literals and never pay for expression dispatch.
    // This is the hottest path in the library (every value of every
    // $set/$project/$group literal flows through here). InferExpression is
    // forgiving (registry dispatch): malformed operands keep the operator's
    // declared result type while the operand brand reports the error at the
    // input position.
    HasOperatorKey<Obj> extends true ? InferExpression<Schema, Obj>
    : InferNestedFieldReferenceObject<Schema, Obj>
  : Obj; // Handles literals (string, number, boolean, null, undefined, etc.)

/**
 * Helper type for resolving field references in arrays
 * Handles both tuple types and regular arrays
 */
type InferNestedFieldReferenceArray<Schema extends Document, Arr> =
  Arr extends [] ? []
  : Arr extends [infer First, ...infer Rest] ?
    [
      InferNestedFieldReference<Schema, First>,
      ...InferNestedFieldReferenceArray<Schema, Rest>,
    ]
  : Arr extends (infer Item)[] ? InferNestedFieldReference<Schema, Item>[]
  : never;

/**
 * Helper type for resolving field references in objects
 * Preserves object structure while resolving any field references
 */
type InferNestedFieldReferenceObject<Schema extends Document, Obj> = Prettify<{
  [K in keyof Obj]: InferNestedFieldReference<Schema, Obj[K]>;
}>;
