import { Timestamp } from "mongodb";
import { Document } from "../utils/objects";
import { Digit, UpperAlphabet, WithoutDollar } from "../utils/strings";
import {
  InvalidVariableNameError,
  PipeSafeError,
  UnknownSystemVariableError,
} from "../utils/errors";
import {
  FieldPath,
  FieldReference,
  FieldReferencesThatInferTo,
  GetFieldTypeWithoutArrays,
  InferNestedFieldReference,
} from "./fieldReference";

/**
 * MongoDB's documented `$$`-system variables, enumerated BY NAME — the
 * AUTHORITATIVE list (never widen a consumer to `` `$$${string}` ``; see
 * the completion-safety invariants in the root CLAUDE.md). Bound USER
 * variables resolve through the `Vars` environment instead
 * (InferVariableReference). The `satisfies` ties the list to
 * SystemVariableSpec: a variable added here without its accurate type
 * fails at this declaration.
 */
export const SYSTEM_VARIABLES = [
  "$$NOW",
  "$$CLUSTER_TIME",
  "$$ROOT",
  "$$CURRENT",
  "$$REMOVE",
  "$$DESCEND",
  "$$PRUNE",
  "$$KEEP",
  "$$SEARCH_META",
  "$$USER_ROLES",
] as const satisfies readonly (keyof SystemVariableSpec<Document>)[];
export type SystemVariable = (typeof SYSTEM_VARIABLES)[number];

/**
 * Accurate result type of each system variable. `$$ROOT`/`$$CURRENT` are
 * the current document (`$$CURRENT` rebinding is not modeled); `$$REMOVE`'s
 * `never` is load-bearing — resolvers strip never-typed fields, which IS
 * its semantics; `$$DESCEND`/`$$PRUNE`/`$$KEEP` are opaque `$redact`
 * markers. `$$SEARCH_META` must stay unknown-VALUED (not `Document` =
 * `Record<string, any>`: an `any`-valued index signature is structurally
 * assignable to Date & friends and would corrupt
 * SystemVariablesThatInferTo).
 */
export interface SystemVariableSpec<Schema extends Document> {
  $$NOW: Date;
  $$CLUSTER_TIME: Timestamp;
  $$ROOT: Schema;
  $$CURRENT: Schema;
  $$REMOVE: never;
  $$DESCEND: unknown;
  $$PRUNE: unknown;
  $$KEEP: unknown;
  $$SEARCH_META: Record<string, unknown>;
  $$USER_ROLES: { _id: string; role: string; db: string }[];
}

/**
 * A variable name plus its dotted paths into `T`. Wide-keyed `T`
 * contributes no dotted arm (a `${string}` template is completion-banned).
 */
type NameAndDottedPaths<Name extends string, T> =
  | Name
  | (string extends FieldPath<T> ? never : `${Name}.${FieldPath<T>}`);

/**
 * The finite `$$` acceptance vocabulary of the USER environment (lookup-let
 * bindings): each entry's exact name plus dotted paths into its type
 * ("$$order.qty"). Unioned with SystemVariableReferences at top-level value
 * positions, so in-scope variables autocomplete and out-of-scope ones
 * reject at the constraint.
 */
export type VariableReferences<Vars extends Document> = {
  [K in keyof Vars & string]: NameAndDottedPaths<`$$${K}`, Vars[K]>;
}[keyof Vars & string];

/**
 * The STATIC system-variable vocabulary: exact names plus dotted paths into
 * the document-typed ones ("$$ROOT.name", "$$USER_ROLES.role"). System
 * variables are deliberately NOT threaded as `Vars` entries — the resolvers
 * fall back to SystemVariableSpec by name instead (measured trade-off; see
 * elements/CLAUDE.md).
 */
export type SystemVariableReferences<Schema extends Document> = {
  [K in SystemVariable]: NameAndDottedPaths<K, SystemVariableSpec<Schema>[K]>;
}[SystemVariable];

/**
 * Every finite `$`-string a top-level value position accepts: field
 * references plus both `$$` tiers.
 */
export type ReferenceValue<
  Schema extends Document,
  Vars extends Document = {},
> =
  | FieldReference<Schema>
  | SystemVariableReferences<Schema>
  | VariableReferences<Vars>;

/** Brands (and the bare `never` of e.g. a null-typed path) → `unknown`. */
type DegradeErrorToUnknown<T> =
  [T] extends [PipeSafeError<string>] ? unknown : T;

/** Keep a brand; anything cleanly resolved is valid (`never`). */
type KeepBrand<T> = [T] extends [PipeSafeError<string>] ? T : never;

/**
 * THE two-tier name lookup (`Name` without the `$$` prefix): the `Vars`
 * USER environment first, then the static SystemVariableSpec — user names
 * must begin lowercase (ValidateVariableName), so the tiers cannot collide.
 * Returns `[type]` when bound (so `$$REMOVE`'s `never` survives), `[]`
 * when not.
 */
type LookupVariable<
  Schema extends Document,
  Name extends string,
  Vars extends Document,
> =
  Name extends keyof Vars ? [Vars[Name]]
  : `$$${Name}` extends keyof SystemVariableSpec<Schema> ?
    [SystemVariableSpec<Schema>[`$$${Name}`]]
  : [];

/**
 * INFERENCE-side resolution of a `$$`-reference, dotted paths included.
 * FORGIVING: anything unresolvable degrades to `unknown`, never to `never`
 * (which would DROP the field from resolvers; rejection is validation's
 * job). The one deliberate `never` is `$$REMOVE`, whose field-dropping IS
 * its semantics.
 */
export type InferVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = {},
> =
  V extends `$$${infer Name}.${infer Path}` ?
    LookupVariable<Schema, Name, Vars> extends [infer T] ?
      DegradeErrorToUnknown<GetFieldTypeWithoutArrays<T, Path>>
    : unknown
  : V extends `$$${infer Name}` ?
    LookupVariable<Schema, Name, Vars> extends [infer T] ?
      T
    : unknown
  : never;

/**
 * VALIDATION-side sibling of InferVariableReference over the same lookup —
 * kernel contract (`never` = valid, else the branded replacement). Unknown
 * names brand as unknown system variables; a bad dotted path gets the
 * Field brand; statically-unknown variable types are skipped.
 */
export type ValidateVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = {},
> =
  V extends SystemVariable ? never
  : V extends `$$${infer Name}.${infer Path}` ?
    LookupVariable<Schema, Name, Vars> extends [infer T] ?
      unknown extends T ?
        never // variable of statically unknown type — nothing to check
      : KeepBrand<GetFieldTypeWithoutArrays<T, Path>>
    : UnknownSystemVariableError<`$$${Name}`>
  : V extends `$$${infer Name}` ?
    LookupVariable<Schema, Name, Vars> extends [unknown] ?
      never
    : UnknownSystemVariableError<V>
  : never;

/**
 * The `$$`-sibling of FieldReferencesThatInferTo, for typed operand sets
 * ($dateAdd's `startDate` accepts "$$NOW"; a numeric operand accepts
 * "$$ROOT.price"). The dotted arms REUSE the schema's cached ref→type map
 * via prefix rewrite rather than building a second map; all arms are
 * finite. `$$REMOVE`'s `never` is excluded explicitly (`never` is
 * assignable to every target). Deliberately Vars-blind: binder/lookup-let
 * interiors skip the operand relation, so bound names never reach these
 * sets.
 */
export type SystemVariablesThatInferTo<Schema extends Document, T> =
  | {
      [K in SystemVariable]: [SystemVariableSpec<Schema>[K]] extends [never] ?
        never
      : SystemVariableSpec<Schema>[K] extends T ? K
      : never;
    }[SystemVariable]
  | `${"$$ROOT" | "$$CURRENT"}.${WithoutDollar<FieldReferencesThatInferTo<Schema, T> & string>}`;

type CharsOf<S extends string> =
  S extends `${infer C}${infer Rest}` ? C | CharsOf<Rest> : never;

/** The ASCII characters MongoDB rejects anywhere in a user variable name. */
type InvalidVariableNameChar = CharsOf<" !\"#$%&'()*+,-./:;<=>?@[\\]^`{|}~">;

/**
 * Kernel contract for a user variable name (`$let.vars`/`$lookup.let` keys,
 * `$map`/`$filter` `as`): MongoDB requires a non-empty name of
 * `[_a-zA-Z0-9]` and non-ASCII characters, starting with a lowercase
 * letter or a non-ASCII character — which also keeps user names clear of
 * the system tier in LookupVariable.
 */
export type ValidateVariableName<Name> =
  Name extends (
    | ""
    | `${UpperAlphabet | Digit | "_"}${string}`
    | `${string}${InvalidVariableNameChar}${string}`
  ) ?
    InvalidVariableNameError<Name>
  : never;

/**
 * The `as` name a $map/$filter binds its element under (MongoDB defaults to
 * "this" when `as` is omitted). A non-literal `as` (a widened string) binds
 * nothing — inference of the real name then degrades to `unknown` (never a
 * wrong type), while validation brands it as an unknown variable.
 */
export type BoundAsName<Operand> =
  Operand extends { as: infer As extends string } ?
    string extends As ?
      never
    : As
  : "this";

/** Bind one variable name (shadowing any outer binding of the same name).
 *  Single lazy mapped type — no Omit/Prettify (see elements/CLAUDE.md on
 *  env-merge depth). */
export type BindVariable<Vars extends Document, Name extends string, T> = {
  [K in keyof Vars | Name]: K extends Name ? T
  : K extends keyof Vars ? Vars[K]
  : never;
};

/**
 * Evaluate a $let `vars` block in the OUTER environment and bind the
 * results (MongoDB: `vars` values cannot reference same-block siblings;
 * inner bindings shadow outer ones). Shared by inference and the
 * validation walk, so the two environments cannot diverge.
 */
export type BindLetVars<
  Schema extends Document,
  LetVars,
  Vars extends Document,
> =
  // A wide (non-literal) block binds nothing: its index signature would
  // shadow every name, system variables included.
  string extends keyof LetVars ? Vars
  : {
      [K in (keyof LetVars & string) | keyof Vars]: K extends keyof LetVars ?
        InferNestedFieldReference<Schema, LetVars[K], Vars>
      : K extends keyof Vars ? Vars[K]
      : never;
    };
