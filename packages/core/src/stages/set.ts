import { InferNestedFieldReference } from "../elements/fieldReference";
import { FieldSelectorKeys } from "../elements/fieldSelector";
import { ExpressionValue } from "../elements/expressions";
import { ValidateNestedValue } from "../elements/validation";
import { PassThrough } from "../utils/errors";
import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { FlattenDotSet, HasDottedKeys } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * The value union for a `$set` assignment — the shared computed-value
 * union (see ExpressionValue, elements/expressions.ts): `$`-keyed objects
 * accepted structurally and re-checked by ValidateSetQuery; `$`-strings
 * are finite unions that autocomplete and reject typos at the constraint.
 */
type SetValue<
  Schema extends Document,
  Vars extends Document = {},
> = ExpressionValue<Schema, Vars>;

/**
 * `$set` query. The `[k: string]` index signature keeps arbitrary new keys
 * (including brand-new dotted paths) legal AND governs value acceptance
 * (`SetValue<Schema>`); the intersected `FieldSelectorKeys` is an
 * AUTOCOMPLETE-ONLY hint that surfaces the schema's existing field selectors
 * as key suggestions. Its value type is `unknown` on purpose — key
 * completion does not depend on it, and instantiating the deep
 * `SetValue<Schema>` union once per field-selector key (as the reviewed
 * design first spelled it) blows the whole-project typecheck from ~7s to a
 * multi-minute hang. `unknown & SetValue<Schema>` (the effective type at a
 * known-selector key, via the index signature) is still `SetValue<Schema>`,
 * so acceptance and value completions are unchanged.
 *
 * `Vars` is the stage's variable environment (Pipeline threads lookup-let
 * bindings through it; system variables resolve statically beside it).
 */
export type SetQuery<Schema extends Document, Vars extends Document = {}> = {
  [k: string]: SetValue<Schema, Vars>;
} & FieldSelectorKeys<Schema, unknown>;

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
export type ValidateSetQuery<
  Schema extends Document,
  Q,
  Vars extends Document = {},
> =
  // Wide-QUERY guard: on constraint failure TS re-instantiates this wrapper
  // with Q = SetQuery<Schema> itself — skip entirely. Schema-DEPENDENT
  // checks guard themselves inside the kernel (ref/operand arms), so the
  // schema-free shape checks (multi-operator, mixed keys) still run on
  // index-signature schemas.
  string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateNestedValue<Schema, Q[K], Vars>;
    }>;

export type ResolveSetQueryValueType<
  Schema extends Document,
  Query,
  Key extends keyof Query,
  Vars extends Document = {},
> =
  Query[Key] extends "$$REMOVE" ? never
  : // InferNestedFieldReference key-dispatches expressions internally; a
    // structural `extends Expression<Schema>` pre-check here would
    // instantiate the full expression union per value.
    InferNestedFieldReference<Schema, Query[Key], Vars>;

// COLLECTION SCHEMA // SET STAGE ==> OUTPUT SCHEMA
// { a?: string | undefined } // { $set: { a: 'hello' }} ==> { a: string }
// { a?: { b?: string | undefined } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello' } }
// { a?: { b: string, c: string } | undefined } // { $set: { 'a.b': 'hello' }} ==> { a: { b: 'hello', c?: string | undefined }}

// Never-valued entries ($$REMOVE) are stripped INSIDE ApplySetUpdates
// (RemoveNeverFields) — don't pre-strip them here or nested removals lose
// their optionality reclassification.
export type ResolveSetInlineSchema<
  Schema extends Document,
  Query,
  Vars extends Document = {},
> = {
  [Key in keyof Query]: ResolveSetQueryValueType<Schema, Query, Key, Vars>;
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
export type ResolveSetOutput<
  Schema extends Document,
  Query,
  Vars extends Document = {},
> = PassThrough<
  Schema,
  ResolveSetOutputInner<Schema, ResolveSetInlineSchema<Schema, Query, Vars>>
>;
