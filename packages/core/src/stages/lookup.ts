import { Document, Prettify } from "../utils/objects";
import { PassThrough, PipeSafeError } from "../utils/errors";
import { FieldPathsThatInferToForLookup } from "../elements/fieldReference";
import { FlattenDotSet, IsDottedKey } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * A dotted `as` path NESTS in MongoDB — `as: "user.orders"` writes
 * `{ user: { orders: [...] } }`, preserving `user`'s sibling fields and
 * overwriting only the target path — exactly the semantics of a `$set` on
 * that path. The resolver therefore reuses the shared dotted-key update
 * kernel (utils/updates.ts: FlattenDotSet to expand, ApplySetUpdates to
 * merge — mirroring ResolveSetOutputInner's early-exit split) instead of
 * re-spelling the expand-and-merge. A FLAT key keeps the cheap `Omit & { [NewKey]: ... }`
 * form: routing it through ApplySetUpdates gave the same output but was
 * measured at ~+65k whole-project instantiations (every lookup call site
 * paid the $set merge machinery for a single top-level key).
 */
export type ResolveLookupOutput<
  Schema extends Document,
  NewKey extends string,
  PipelineOutput extends Document,
> = PassThrough<
  Schema,
  // distribute over union schemas
  Schema extends unknown ?
    IsDottedKey<NewKey> extends true ?
      ApplySetUpdates<
        Schema,
        FlattenDotSet<{ [K in NewKey]: PipelineOutput[] }>
      >
    : Prettify<Omit<Schema, NewKey> & { [K in NewKey]: PipelineOutput[] }>
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
