import { InferExpression, ServerFunctionRef } from "./expressions";
import { GetFieldTypeWithoutArrays } from "./fieldReference";
import { NotAnExpression } from "../utils/dispatch";
import { Document, NonExpandableTypes } from "../utils/objects";

// ============================================================================
// $function — args → body parameter correlation
// ============================================================================
//
// A $function's `args` determine its body's expected parameter types: with
// `args: ["$age"]`, the body's params are typed from the args — and a wrong
// annotation or wrong arity fails with a native TS error at the body — at
// any nesting depth.
//
// This correlation can't live inside the registry's `$function` operand
// (elements/expressions.ts): relating two properties of one literal
// requires TS to infer that literal, and inference only happens at a
// generic call site. Two cooperating pieces are applied at Pipeline method
// signatures:
//
// 1. `DeepValidateFunctions<Schema, S>` — VALIDATION at any depth. A
//    rewrite of the literal's own type; works everywhere but cannot
//    contextually type unannotated params (TS does not resolve conditional
//    types over the same in-flight type parameter when computing contextual
//    types — verified empirically).
//
// 2. `FunctionSlots<Schema, A>` — CONTEXTUAL PARAM TYPES for unannotated
//    bodies at top-level keys. Uses a SECOND inferred type parameter `A`
//    (per-key args map): conditionals over an independently-inferred,
//    already-fixed parameter DO resolve in contextual position, so
//    `body: (a) => a * 2` with `args: ["$age"]` gets `a: number` with no
//    annotation. Nested $function (inside $add/$cond/accumulators) params
//    still require annotations — there is no inference site for args at
//    arbitrary depth.

/**
 * Recursively strip `readonly` and force-evaluate lazy captured types.
 * Args captured through deep `FunctionSlots` variables arrive as readonly
 * REVERSE-MAPPED structures — placeholders TypeScript has not evaluated
 * yet. `InferExpression`'s operator-key dispatch resolves differently over
 * such a placeholder (the `$function` dependent arm falls through and the
 * arg degrades to `unknown`); the mapped-type rewrite here forces the
 * structure to evaluate before dispatch. Scope is ONE $function's args
 * tuple at capture sites — not the per-literal Validate walk whose
 * DeepMutable variant was measured and rejected on main.
 */
type DeepMutable<T> =
  [T] extends [NonExpandableTypes | RegExp | null | undefined] ? T
  : [T] extends [(...a: never[]) => unknown] ? T
  : T extends readonly unknown[] ?
    { -readonly [I in keyof T]: DeepMutable<T[I]> }
  : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T;

/**
 * Resolve a single $function arg to the runtime type the server passes to
 * the body: field references and expressions resolve to their inferred
 * types; literals are themselves. Non-distributive (`[Arg] extends [...]`)
 * so mixed unions don't fan out per-branch.
 *
 * PERF: deliberately avoids testing against `FieldReference<Schema>` and
 * `Expression<Schema>` — both are huge unions (every dotted path of the
 * schema; every operator shape), and this alias is instantiated with FRESH
 * captured types at every $function site (validator + each slots chain),
 * so those relation checks miss TypeScript's cache every time. String args
 * are dispatched on their `$` prefix and parsed by
 * `GetFieldTypeWithoutArrays` directly; object args go straight to
 * `InferExpression`, THE operator-key dispatch (the `NotAnExpression`
 * sentinel routes plain-object args back to their literal type).
 */
type ResolveFunctionArg<Schema extends Document, Arg> =
  // System variables ($$NOW, $$ROOT, ...) — their runtime type is not
  // modeled, so the expected param is `any`: contravariance then accepts
  // ANY user annotation (`(d: Date)` for `$$NOW` compiles), while an
  // unannotated param's `any` drags the body's return type to `any`,
  // which NormalizeFunctionReturn (elements/expressions.ts) brands —
  // loud, and fixed by annotating. (`never` would break unannotated
  // params cryptically; `unknown` would reject valid annotations.)
  [Arg] extends [`$$${string}`] ? any
  : [Arg] extends [`$${infer Path}`] ?
    NonNullable<GetFieldTypeWithoutArrays<Schema, Path>>
  : [Arg] extends [object] ?
    InferExpression<Schema, DeepMutable<Arg>> extends infer R ?
      [R] extends [NotAnExpression] ?
        Arg
      : R
    : never
  : Arg;

/**
 * Map an `args` tuple to the body's expected parameter tuple.
 */
type ResolveFunctionParams<Schema extends Document, Args> =
  Args extends readonly unknown[] ?
    { -readonly [I in keyof Args]: ResolveFunctionArg<Schema, Args[I]> }
  : never;

/**
 * Identity rewrite unless V contains a $function — recursive, so bodies are
 * correlated with their args at ANY depth (inside $add, $cond branches,
 * accumulators, even another $function's args). Recursion is bounded by the
 * literal the user wrote, not the schema, so cost stays proportional to the
 * query. For non-$function subtrees this resolves to V itself, leaving the
 * stage's existing call-site behavior undisturbed.
 */
type DeepValidateFunctionsRewrite<Schema extends Document, V> =
  // Pass-throughs: functions (incl. facet/sub-pipeline builders), serverFn
  // markers, and non-expandable values (Date, RegExp, BSON types)
  [V] extends [(...a: any[]) => any] ? V
  : [V] extends [ServerFunctionRef] ? V
  : [V] extends [NonExpandableTypes | RegExp | null | undefined] ? V
  : [V] extends [{ $function: { args: infer A } }] ?
    // NoInfer: without it the rewritten body slot back-feeds inference —
    // the stage's literal type parameter picks up `args` candidates from
    // the body's PARAMETER annotations (widened, readonly) instead of the
    // written args literal, corrupting dispatch and neutralizing the
    // correlation check.
    //
    // NOTE: the body slot must not reference V's own body type — doing so
    // makes the contextual type self-referential and TS reports TS7023
    // circularity on inferred-return bodies. The any-return case
    // (unannotated params) is branded on the inference side instead
    // (NormalizeFunctionReturn in elements/expressions.ts).
    NoInfer<{
      $function: {
        body:
          | ((
              ...params: ResolveFunctionParams<Schema, A> & unknown[]
            ) => unknown)
          | ServerFunctionRef<
              (
                ...params: ResolveFunctionParams<Schema, A> & unknown[]
              ) => unknown
            >;
        // args may nest $function expressions of their own
        args: {
          -readonly [I in keyof A]: DeepValidateFunctionsRewrite<Schema, A[I]>;
        };
        lang: "js";
      };
    }>
  : V extends readonly unknown[] ?
    { -readonly [I in keyof V]: DeepValidateFunctionsRewrite<Schema, V[I]> }
  : V extends object ?
    { -readonly [K in keyof V]: DeepValidateFunctionsRewrite<Schema, V[K]> }
  : V;

/**
 * Cheap deep probe: does the literal contain a `$function` key anywhere?
 * Pure boolean evaluation — no fresh object structures, so no structural
 * relation work for TypeScript to do afterwards.
 */
type ContainsFunction<V> =
  [V] extends [(...a: any[]) => any] ? false
  : [V] extends [NonExpandableTypes | RegExp | null | undefined] ? false
  : [V] extends [{ $function: unknown }] ? true
  : // Arrays: probe the ELEMENT UNION (distributed below) — indexing a
  // mapped tuple by `keyof V` would drag the mapped array prototype
  // (toString, slice, ...) into type instantiation for every tuple
  [V] extends [readonly unknown[]] ?
    true extends ContainsFunctionDistributed<V[number]> ?
      true
    : false
  : [V] extends [object] ?
    true extends { [K in keyof V]: ContainsFunction<V[K]> }[keyof V] ?
      true
    : false
  : false;

/** Distributes ContainsFunction over an element union (OR semantics). */
type ContainsFunctionDistributed<V> =
  V extends unknown ? ContainsFunction<V> : never;

/**
 * EARLY EXIT: the rewrite + the structural relation against it is paid by
 * EVERY stage call (`$set: S & ValidateSetQuery<...> & DeepValidateFunctions
 * <D, S> & ...`), and for the overwhelmingly common $function-free literal
 * it is pure overhead — measured ~10-20x slow-down on call-heavy
 * $function-free files (e.g. Pipeline.typeAssertions 0.2s -> 4.4s).
 * Resolving to `unknown` collapses the intersection member (`X & unknown`
 * simplifies away), so TypeScript skips the relation entirely; the boolean
 * probe walks the literal once without creating comparable structures.
 */
export type DeepValidateFunctions<Schema extends Document, V> =
  [ContainsFunction<V>] extends [true] ? DeepValidateFunctionsRewrite<Schema, V>
  : unknown;

/**
 * The expected shape of a $function value whose args tuple is `A` — body
 * parameter types computed from the args. Because `A` is an independent,
 * already-inferred type parameter (not the in-flight stage literal), TS
 * resolves these conditionals when computing the body's CONTEXTUAL type, so
 * unannotated params receive real types.
 */
type FunctionSlot<Schema extends Document, A> = {
  $function: {
    args: A;
    body:
      | ((...params: ResolveFunctionParams<Schema, A> & unknown[]) => unknown)
      | ServerFunctionRef<
          (...params: ResolveFunctionParams<Schema, A> & unknown[]) => unknown
        >;
    lang: "js";
  };
};

/**
 * Contextual-typing companion to `DeepValidateFunctions`, intersected at
 * stage signatures as an additional member:
 *
 *   set<const S extends SetQuery<D>, A extends Record<string, unknown> = {}>(
 *     $set: S & ValidateSetQuery<D, S> &
 *       DeepValidateFunctions<D, S> & FunctionSlots<D, A>
 *   )
 *
 * `A` reverse-infers a per-key map of $function args ONLY for keys whose
 * value is a $function (the slot's `args: A[K]` is the sole inference
 * site). Keys without a candidate stay `unknown` and resolve to the
 * pass-through branch, so plain values are unaffected.
 *
 * The `NoInfer` in the check position is load-bearing: a conditional's
 * check type is itself an inference site, and without the shield every
 * plain value would leak into `A` and instantiate a slot it cannot satisfy.
 *
 * DELIBERATELY top-level only. Contextual typing for NESTED $functions
 * (inside $add/$cond arrays etc.) is achievable — verified with per-depth
 * and per-container-shape capture variables (one independent type variable
 * per nesting shape; see the signature-patterns notes in CLAUDE.md) — but
 * costs ~2-5s of typecheck per $function call site: every capture is a
 * fresh reverse-mapped type that defeats the relation cache, and record
 * hops reverse-map TUPLE values, materializing every Array.prototype
 * member per array per call (~4x total suite cost, measured). A nested
 * unannotated param fails loudly as TS7006 and one annotation fixes it,
 * so the trade is not worth it. Revisit if TypeScript's reverse-mapped
 * inference gets cheaper.
 */
export type FunctionSlots<
  Schema extends Document,
  A extends Record<string, unknown>,
> = {
  [K in keyof A]: [unknown] extends [NoInfer<A[K]>] ? unknown
  : FunctionSlot<Schema, A[K]>;
};
