import {
  FieldReference,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { FieldSelectorKeys } from "../elements/fieldSelector";
import { Expression } from "../elements/expressions";
import {
  AnyLiteral,
  ExpressionShaped,
  SystemVariable,
} from "../elements/literals";
import { ValidateNestedValue } from "../elements/validation";
import { PassThrough } from "../utils/errors";
import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { FlattenDotSet, HasDottedKeys } from "../utils/paths";
import { ApplySetUpdates } from "../utils/updates";

/**
 * The value union for a `$set` assignment. `$`-keyed OBJECTS are accepted
 * STRUCTURALLY (`ExpressionShaped`) and re-checked by `ValidateSetQuery`;
 * `$`-STRING values resolve to finite unions so they both autocomplete AND
 * reject typos at the constraint (a typo'd ref errors with a single TS2820
 * "Did you mean '$name'?" at the value — no validation walk needed for the
 * string case).
 *
 * Every string arm is FINITE — `FieldReference<Schema>` (schema-derived)
 * and `SystemVariable` (the enumerated `$$` vocabulary, "$$REMOVE"
 * included). No wide `` `$${string}` `` template exists here: a template
 * wide enough to accept arbitrary `$`-strings necessarily ABSORBS the
 * finite ref literals out of autocomplete (same predicate decides both),
 * and the `` & {} `` non-absorption spelling leaks String.prototype into
 * sibling object-literal completions. Finite literals have neither
 * problem.
 *
 * `Expression<Schema>` is an AUTOCOMPLETE-ONLY member: for checking it is
 * subsumed by `ExpressionShaped` (every valid expression is
 * expression-shaped), so it cannot decide acceptance — do not "fix"
 * acceptance bugs by editing it.
 */
type SetValue<Schema extends Document> =
  | AnyLiteral<Schema>
  | Expression<Schema>
  | FieldReference<Schema>
  | SystemVariable
  | ExpressionShaped;

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
 */
export type SetQuery<Schema extends Document> = {
  [k: string]: SetValue<Schema>;
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
