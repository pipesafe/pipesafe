import { Document, PassThrough, PipeSafeError, Prettify } from "../utils/core";
import { FieldPathsThatInferToForLookup } from "../elements/fieldReference";

// Todo: Convert new key to a nested field and merge
export type ResolveLookupOutput<
  StartingDocs extends Document,
  NewKey extends string,
  PipelineOutput extends Document,
> = PassThrough<
  StartingDocs,
  StartingDocs extends any ?
    Prettify<Omit<StartingDocs, NewKey> & { [K in NewKey]: PipelineOutput[] }>
  : never
>;

/**
 * Union of foreign-collection paths whose inferred type is compatible
 * with the local field's type, accounting for MongoDB's element-wise
 * array matching: `T = T`, `T[] → T`, `T → T[]`, and `T[] = T[]` are all
 * valid. The `(infer Element)[]` arm strips the array wrapper for any
 * element type, so this works for primitive arrays, complex-object
 * arrays, and dotted paths whose inferred type is array-shaped.
 */
export type LookupCompatibleFieldPaths<
  ForeignSchema extends Document,
  LocalFieldType,
> =
  | FieldPathsThatInferToForLookup<
      ForeignSchema,
      LocalFieldType extends string ? string : LocalFieldType
    >
  | FieldPathsThatInferToForLookup<ForeignSchema, LocalFieldType>
  | (LocalFieldType extends (infer Element)[] ?
      FieldPathsThatInferToForLookup<ForeignSchema, Element>
    : never)
  | FieldPathsThatInferToForLookup<ForeignSchema, LocalFieldType[]>;

/**
 * Resolves to the union of valid foreign-field paths, OR a branded
 * `PipeSafeError` when no foreign field on the joined collection has a
 * type compatible with the local field's type. Without this brand the
 * constraint silently fell through to `never`, producing the unhelpful
 * "Type 'X' is not assignable to type 'never'" hover.
 *
 * Passes through upstream errors: if either the foreign schema or the
 * resolved local field type is already a `PipeSafeError` (from an
 * earlier stage), surface that error instead of computing a fresh
 * no-compatible-field brand on top of it.
 */
export type LookupForeignFieldOrError<
  ForeignSchema extends Document,
  LocalFieldType,
  LocalField extends string,
> =
  ForeignSchema extends PipeSafeError<string> ? ForeignSchema
  : LocalFieldType extends PipeSafeError<string> ? LocalFieldType
  : [LookupCompatibleFieldPaths<ForeignSchema, LocalFieldType>] extends (
    [never]
  ) ?
    PipeSafeError<`Foreign collection has no field with a type compatible with localField '${LocalField}'.`>
  : LookupCompatibleFieldPaths<ForeignSchema, LocalFieldType>;
