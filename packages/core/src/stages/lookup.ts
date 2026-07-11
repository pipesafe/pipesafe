import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { PassThrough, PipeSafeError } from "../utils/errors";
import {
  FieldPathsThatInferToForLookup,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { ExpressionValue } from "../elements/expressions";
import { ValidateNestedValue } from "../elements/validation";
import { FlattenDotSet, IsDottedKey } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * The `$lookup.let` block: variable name → an expression over the OUTER
 * schema/environment (the shared computed-value union; ValidateLookupLet
 * re-checks the literal).
 */
export type LookupLetQuery<
  Schema extends Document,
  Vars extends Document = {},
> = {
  [name: string]: ExpressionValue<Schema, Vars>;
};

/**
 * Key-filtered validation wrapper for the `let` block (mirrors
 * ValidateSetQuery): values walk the kernel against the OUTER
 * schema/environment; a fully-valid block validates against `{}`; the
 * wide-QUERY guard covers the constraint-failure fallback.
 */
export type ValidateLookupLet<
  Schema extends Document,
  Let,
  Vars extends Document = {},
> =
  string extends keyof Let ? {}
  : OmitNeverValues<{
      [K in keyof Let]: ValidateNestedValue<Schema, Let[K], Vars>;
    }>;

/**
 * The sub-pipeline's user-binding environment: the enclosing `Env` (outer
 * bindings stay visible in nested lookups) with this lookup's `let`
 * bindings layered on, inferred against the OUTER schema/environment.
 * System variables resolve against the FOREIGN schema instead — MongoDB's
 * scoping: `$$ROOT` inside the sub-pipeline is the foreign document; the
 * outer document comes in through `let`.
 */
export type ResolveLookupLetEnv<
  Schema extends Document,
  Let,
  Env extends Document,
  Vars extends Document = {},
> = {
  // Single lazy mapped type — no Omit/Prettify (see elements/CLAUDE.md on
  // env-merge depth).
  [K in (keyof Let & string) | keyof Env]: K extends keyof Let ?
    InferNestedFieldReference<Schema, Let[K], Vars>
  : K extends keyof Env ? Env[K]
  : never;
};

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
