import { InferNestedFieldReference } from "../elements/fieldReference";
import { FieldSelectorKeys } from "../elements/fieldSelector";
import { ExpressionValue } from "../elements/expressions";
import { ValidateNestedRecord } from "../elements/validation";
import { PassThrough } from "../utils/errors";
import { Document, Prettify } from "../utils/objects";
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
 * `Pipeline.set`'s rejection surface — the shared key-filtered record
 * wrapper. `"$$REMOVE"` needs no special case: the kernel accepts the
 * `$$`-system-variable namespace.
 */
export type ValidateSetQuery<
  Schema extends Document,
  Q,
  Vars extends Document = {},
> = ValidateNestedRecord<Schema, Q, Vars>;

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
  // Wide query (non-literal, or the constraint-failure fallback): skip inference.
  string extends keyof Query ? Document
  : ResolveSetOutputInner<Schema, ResolveSetInlineSchema<Schema, Query, Vars>>
>;
