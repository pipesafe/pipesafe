import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { PassThrough, PipeSafeError } from "../utils/errors";
import { FieldPathsThatInferToForLookup } from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral, ExpressionShaped } from "../elements/literals";
import { ValidateNestedValue } from "../elements/validation";
import { FlattenDotSet, IsDottedKey } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * `let` variable bindings for $lookup correlated sub-pipelines. Values are
 * field references or expressions evaluated against the LOCAL (outer)
 * documents; the sub-pipeline reads them as `$$variableName` references,
 * typically inside a `$match` stage's `$expr`.
 *
 * `$`-shaped values are accepted STRUCTURALLY (mirroring `SetQuery` — a
 * `let` binding is a $set-value-shaped expression over the local docs) and
 * re-checked by `ValidateLookupLetQuery`; `Expression<Schema>` is
 * autocomplete-only, subsumed by `ExpressionShaped` for checking.
 */
export type LookupLet<Schema extends Document> = {
  [variableName: string]:
    | AnyLiteral<Schema>
    | Expression<Schema>
    | `$${string}`
    | ExpressionShaped
    | null;
};

/**
 * Key-filtered validation wrapper for `Pipeline.lookup`'s `let` bindings,
 * wired as the `Let & ValidateLookupLetQuery<Schema, Let>` intersection
 * (THE pattern for index-signature query types). Re-uses the shared
 * nested-validation kernel, so unknown local `$`-refs, malformed expression
 * objects, and invalid operands brand at the offending value; a fully valid
 * `let` validates against `{}`. The `string extends keyof Q` guard skips
 * the walk when Q is not a literal (the constraint-failure fallback
 * re-instantiates the wrapper with `LookupLet<Schema>` itself).
 */
export type ValidateLookupLetQuery<Schema extends Document, Q> =
  string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateNestedValue<Schema, Q[K]>;
    }>;

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
  Foreign extends Document,
> = PassThrough<
  Schema,
  // distribute over union schemas
  Schema extends unknown ?
    IsDottedKey<NewKey> extends true ?
      ApplySetUpdates<Schema, FlattenDotSet<{ [K in NewKey]: Foreign[] }>>
    : Prettify<Omit<Schema, NewKey> & { [K in NewKey]: Foreign[] }>
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
  Foreign extends Document,
  LocalFieldType,
> =
  | FieldPathsThatInferToForLookup<
      Foreign,
      LocalFieldType extends string ? string : LocalFieldType
    >
  | FieldPathsThatInferToForLookup<Foreign, LocalFieldType>
  | (LocalFieldType extends (infer Element)[] ?
      FieldPathsThatInferToForLookup<Foreign, Element>
    : never)
  | FieldPathsThatInferToForLookup<Foreign, LocalFieldType[]>;

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
  Foreign extends Document,
  LocalFieldType,
  LocalField extends string,
> =
  Foreign extends PipeSafeError<string> ? Foreign
  : LocalFieldType extends PipeSafeError<string> ? LocalFieldType
  : [LookupCompatibleFieldPaths<Foreign, LocalFieldType>] extends [never] ?
    PipeSafeError<`Foreign collection has no field with a type compatible with localField '${LocalField}'.`>
  : LookupCompatibleFieldPaths<Foreign, LocalFieldType>;
