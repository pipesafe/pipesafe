import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { PassThrough, PipeSafeError } from "../utils/errors";
import {
  FieldPathsThatInferToForLookup,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { ExpressionValue } from "../elements/expressions";
import { SystemVariables } from "../elements/literals";
import { ValidateNestedValue } from "../elements/validation";
import { FlattenDotSet, IsDottedKey } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * The `$lookup.let` block: variable name → an expression evaluated against
 * the OUTER (joining) schema in the OUTER environment. The values are the
 * shared computed-value union, so field refs, `$$`-variables (including an
 * enclosing lookup's own bindings — lookups nest), literals, and expression
 * objects are all accepted; ValidateLookupLet re-checks the literal.
 */
export type LookupLetQuery<
  Schema extends Document,
  Vars extends Document = SystemVariables<Schema>,
> = {
  [name: string]: ExpressionValue<Schema, Vars>;
};

/**
 * Key-filtered validation wrapper for the `let` block (mirrors
 * ValidateSetQuery): values walk the shared nested-validation kernel
 * against the OUTER schema/environment, offending keys map to the kernel's
 * replacement, and a fully-valid block validates against `{}`. The
 * wide-QUERY guard skips the walk when the constraint-failure fallback
 * instantiates this with the wide LookupLetQuery itself.
 */
export type ValidateLookupLet<
  Schema extends Document,
  Let,
  Vars extends Document = SystemVariables<Schema>,
> =
  string extends keyof Let ? {}
  : OmitNeverValues<{
      [K in keyof Let]: ValidateNestedValue<Schema, Let[K], Vars>;
    }>;

/**
 * The sub-pipeline's user-binding environment: the enclosing pipeline's
 * `Env` (lookups nest — outer bindings stay visible) with this lookup's
 * `let` bindings layered on, each inferred against the OUTER schema in the
 * OUTER environment — the same authority the values were validated with.
 * Pipeline seeds the sub-pipeline's system variables over the FOREIGN
 * schema separately (PipelineVars), which is exactly MongoDB's scoping:
 * `$$ROOT` inside the sub-pipeline is the foreign document; the outer
 * document's fields come in through `let`.
 */
export type ResolveLookupLetEnv<
  Schema extends Document,
  Let,
  Env extends Document,
  Vars extends Document = SystemVariables<Schema>,
> = {
  // ONE mapped type with lazy values (see PipelineVars) — binding types
  // are only computed when a `$$name` is actually looked up.
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
