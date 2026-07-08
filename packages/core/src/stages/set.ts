import { InferNestedFieldReference } from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral, ExpressionShaped } from "../elements/literals";
import { ValidateNestedValue } from "../elements/validation";
import { PassThrough } from "../utils/errors";
import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { FlattenDotSet, HasDottedKeys } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * `$`-shaped values (`$`-strings, `$`-keyed objects) are accepted
 * STRUCTURALLY here and re-checked by `ValidateSetQuery`. Rejecting them
 * through the deep `AnyLiteral | Expression` union instead accumulates
 * relation depth on the shared call-checking stack and surfaces spurious
 * statement-level TS2589s next to the real error.
 *
 * `Expression<Schema>` and `"$$REMOVE"` are AUTOCOMPLETE-ONLY members:
 * for checking they are subsumed by `ExpressionShaped` and `` `$${string}` ``
 * respectively (every valid expression is expression-shaped; "$$REMOVE" is
 * a $-string), so neither can decide acceptance — do not "fix" acceptance
 * bugs by editing them.
 */
export type SetQuery<Schema extends Document> = {
  [k: string]:
    | AnyLiteral<Schema>
    | Expression<Schema>
    | `$${string}`
    | ExpressionShaped
    | "$$REMOVE";
};

/**
 * Key-filtered validation wrapper for `Pipeline.set`:
 * OmitNeverValues drops valid keys, so a fully-valid query validates
 * against `{}` and the `$set: Q & ValidateSetQuery<Schema, Q>` intersection
 * costs nothing on the happy path; only offending keys survive, mapped to
 * the kernel's replacement so TS2322 lands at the offending value. The
 * `string extends keyof Q` guard skips validation entirely when Q is not a
 * literal query (the constraint-failure fallback instantiates the wrapper
 * with SetQuery<Schema> itself — walking its wide value unions would brand
 * valid keys and overflow the instantiation depth on top of the real
 * error). `"$$REMOVE"` needs no special case: the kernel accepts the
 * `$$`-system-variable namespace.
 */
export type ValidateSetQuery<Schema extends Document, Q> =
  // Wide-QUERY guard: on constraint failure TS re-instantiates this wrapper
  // with Q = SetQuery<Schema> itself — skip entirely. Schema-DEPENDENT
  // checks guard themselves inside the kernel (ref/operand arms), so the
  // schema-free shape checks (multi-operator, mixed keys) still run on
  // index-signature schemas.
  string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateNestedValue<Schema, Q[K]>;
    }>;

export type ResolveSetQueryValueType<
  Schema extends Document,
  Query,
  Key extends keyof Query,
> =
  Query[Key] extends "$$REMOVE" ? never
  : // InferNestedFieldReference key-dispatches expressions internally; a
    // structural `extends Expression<Schema>` pre-check here would
    // instantiate the full expression union per value.
    InferNestedFieldReference<Schema, Query[Key]>;

// COLLECTION SCHEMA // SET STAGE ==> OUTPUT SCHEMA
// { a?: string | undefined } // { $set: { a: 'hello' }} ==> { a: string }
// { a?: { b?: string | undefined } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello' } }
// { a?: { b: string, c: string } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello', c?: string | undefined }}

// Never-valued entries ($$REMOVE) are stripped INSIDE ApplySetUpdates
// (RemoveNeverFields) — don't pre-strip them here or nested removals lose
// their optionality reclassification.
export type ResolveSetInlineSchema<Schema extends Document, Query> = {
  [Key in keyof Query]: ResolveSetQueryValueType<Schema, Query, Key>;
};

// Inner resolver with the inline schema hoisted to a parameter. Sits INSIDE
// the PassThrough happy path so an upstream error never pays for it.
type ResolveSetOutputInner<Schema extends Document, Inline extends Document> =
  HasDottedKeys<Inline> extends true ?
    // Has dotted keys - flatten them into nested structure first
    Prettify<ApplySetUpdates<Schema, FlattenDotSet<Inline>>>
  : // No dotted keys - skip FlattenDotSet entirely (Early Exit optimization)
    Prettify<ApplySetUpdates<Schema, Inline>>;

// No `Query extends SetQuery<Schema>` re-check: Pipeline.set's generic
// constraint already validated the query, and re-proving it would
// instantiate the full SetQuery mapped type per call.
export type ResolveSetOutput<Schema extends Document, Query> = PassThrough<
  Schema,
  ResolveSetOutputInner<Schema, ResolveSetInlineSchema<Schema, Query>>
>;
