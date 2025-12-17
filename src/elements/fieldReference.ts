import {
  Document,
  Join,
  DollarPrefixed,
  NonExpandableTypes,
  WithoutDollar,
  NoDollarString,
  Prettify,
} from "../utils/core";
import { FieldSelector, InferFieldSelector } from "./fieldSelector";
import { Expression, InferExpression } from "./expressions";

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

export type GetFieldTypeWithoutArrays<Schema, Path extends string> =
  Schema extends (infer U)[] ? GetFieldTypeWithoutArrays<U, Path>[]
  : Path extends keyof Schema ?
    Schema[Path] // Direct property access
  : Path extends `${infer Head}.${infer Tail}` ?
    Head extends keyof Schema ?
      GetFieldTypeWithoutArrays<Schema[Head], Tail> // Recurse into property
    : never
  : never;

// Infer the type of a field at a given selector
// If traversing an array (which will always be without an index as these are not supported), return an array of the nested field type
export type InferFieldReference<
  Schema extends Document,
  Ref extends FieldReference<Schema>,
> = GetFieldTypeWithoutArrays<Schema, WithoutDollar<Ref>>;

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
    {
      [K in FieldReference<Schema>]: DesiredType extends (
        InferFieldReference<Schema, K>
      ) ?
        K
      : never;
    }[FieldReference<Schema>]
  : never;

export type FieldReferencesThatInferTo<Schema extends Document, DesiredType> =
  Schema extends unknown ?
    {
      [K in FieldReference<Schema>]: InferFieldReference<Schema, K> extends (
        DesiredType
      ) ?
        K
      : never;
    }[FieldReference<Schema>]
  : never;

export type ElementResolvingToType<Schema extends Document, Type> =
  Type extends string ?
    FieldReferencesThatInferTo<Schema, string> | NoDollarString
  : Type extends object ?
    Type extends Function ?
      never
    : | FieldReferencesThatInferTo<Schema, Type>
      | {
          [K in keyof Type]: Type[K] extends string ?
            FieldReferencesThatInferTo<Schema, string> | NoDollarString
          : ArrayResolvingToType<Schema, Type[K]> extends Array<infer U> ? U
          : Type[K];
        }
  : Type | FieldReferencesThatInferTo<Schema, Type>;

// Perhaps should be ArrayResolvingToSameType<Schema>
export type ArrayResolvingToType<
  Schema extends Document,
  Type,
> = ElementResolvingToType<Schema, Type>[];

export type MatcherThatOnlyDoesEquals<Schema extends Document> =
  | {
      [K in FieldSelector<Schema>]: InferFieldSelector<Schema, K>;
    }
  | {
      $expr: {
        $eq:
          | ArrayResolvingToType<Schema, string>
          | ArrayResolvingToType<Schema, number>;
      };
    };

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
  : Obj extends Expression<Schema> ? InferExpression<Schema, Obj>
  : Obj extends `$${string}` ? never
  : Obj extends unknown[] ? InferNestedFieldReferenceArray<Schema, Obj>
  : Obj extends object ?
    Obj extends NonExpandableTypes ?
      Obj
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
