import { ObjectId, Timestamp } from "mongodb";
import { Document, ForbidKeys } from "../utils/objects";
import { NoDollarString, WithoutDollar } from "../utils/strings";
import {
  FieldPath,
  FieldReferencesThatInferTo,
  GetFieldTypeWithoutArrays,
} from "./fieldReference";
import { PipeSafeError, UnknownSystemVariableError } from "../utils/errors";

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
 * `true` inside a `$let`/`$map`/`$filter` interior or `$lookup.let`
 * sub-pipeline. The validation kernel forks on this: registry operand
 * relations are Vars-blind, so they demote to fast-accepts with the
 * name/ref walk catching the leftovers.
 */
export type HasUserBindings<Vars extends Document> =
  [keyof Vars] extends [never] ? false : true;

/**
 * The finite `$$` acceptance vocabulary of the USER environment (lookup-let
 * bindings): each entry's exact name plus dotted paths into its type
 * ("$$order.qty"). Unioned with SystemVariableReferences at top-level value
 * positions, so in-scope variables autocomplete and out-of-scope ones
 * reject at the constraint. Wide-keyed entries contribute no dotted arm
 * (a `${string}` template there is completion-banned).
 */
export type VariableReferences<Vars extends Document> = {
  [K in keyof Vars & string]:
    | `$$${K}`
    | (string extends FieldPath<Vars[K]> ? never
      : `$$${K}.${FieldPath<Vars[K]>}`);
}[keyof Vars & string];

/**
 * The STATIC system-variable vocabulary: exact names plus dotted paths into
 * the document-typed ones ("$$ROOT.name", "$$USER_ROLES.role"). System
 * variables are deliberately NOT threaded as `Vars` entries — the resolvers
 * fall back to SystemVariableSpec by name instead (measured trade-off; see
 * elements/CLAUDE.md).
 */
export type SystemVariableReferences<Schema extends Document> = {
  [K in SystemVariable]:
    | K
    | (string extends FieldPath<SystemVariableSpec<Schema>[K]> ? never
      : `${K}.${FieldPath<SystemVariableSpec<Schema>[K]>}`);
}[SystemVariable];

/** Brands (and the bare `never` of e.g. a null-typed path) → `unknown`. */
type DegradeErrorToUnknown<T> =
  [T] extends [PipeSafeError<string>] ? unknown : T;

/** Keep a brand; anything cleanly resolved is valid (`never`). */
type KeepBrand<T> = [T] extends [PipeSafeError<string>] ? T : never;

/**
 * INFERENCE-side resolution of a `$$`-reference, dotted paths included.
 * TWO-TIER: the `Vars` USER environment (names WITHOUT the `$$` prefix)
 * first, then the static SystemVariableSpec — MongoDB user variables must
 * begin lowercase, so the tiers cannot collide. FORGIVING: anything
 * unresolvable degrades to `unknown`, never to `never` (which would DROP
 * the field from resolvers; rejection is validation's job). The one
 * deliberate `never` is `$$REMOVE`, whose field-dropping IS its semantics.
 */
export type InferVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = {},
> =
  V extends `$$${infer Name}.${infer Path}` ?
    Name extends keyof Vars ?
      DegradeErrorToUnknown<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : `$$${Name}` extends keyof SystemVariableSpec<Schema> ?
      DegradeErrorToUnknown<
        GetFieldTypeWithoutArrays<SystemVariableSpec<Schema>[`$$${Name}`], Path>
      >
    : unknown
  : V extends `$$${infer Name}` ?
    Name extends keyof Vars ? Vars[Name]
    : V extends keyof SystemVariableSpec<Schema> ? SystemVariableSpec<Schema>[V]
    : unknown
  : never;

/**
 * VALIDATION-side sibling of InferVariableReference — same two-tier
 * resolution, kernel contract (`never` = valid, else the branded
 * replacement). Unknown names brand as unknown system variables; dotted
 * paths resolve through the same authority inference uses, so a bad path
 * gets the Field brand; statically-unknown variable types are skipped.
 */
export type ValidateVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = {},
> =
  V extends SystemVariable ? never
  : V extends `$$${infer Name}.${infer Path}` ?
    Name extends keyof Vars ?
      unknown extends Vars[Name] ?
        never // variable of statically unknown type — nothing to check
      : KeepBrand<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : `$$${Name}` extends keyof SystemVariableSpec<Schema> ?
      unknown extends SystemVariableSpec<Schema>[`$$${Name}`] ?
        never
      : KeepBrand<
          GetFieldTypeWithoutArrays<
            SystemVariableSpec<Schema>[`$$${Name}`],
            Path
          >
        >
    : UnknownSystemVariableError<`$$${Name}`>
  : V extends `$$${infer Name}` ?
    Name extends keyof Vars ?
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
  | `$$ROOT.${WithoutDollar<FieldReferencesThatInferTo<Schema, T> & string>}`
  | `$$CURRENT.${WithoutDollar<FieldReferencesThatInferTo<Schema, T> & string>}`;

export type LiteralOrFieldReferenceInferringTo<Schema extends Document, T> =
  | T
  | FieldReferencesThatInferTo<Schema, T>;

type Primitive = boolean | number | Date | NoDollarString | ObjectId;

// Completion-safe literal-VALUE arm: Date/ObjectId are carried as the keyless
// `object` so their ~50 members (getDate, toHexString, _bsontype, …) stop
// polluting the operator-key completions of every expression-object value
// position, while Date/ObjectId VALUES (a `new Date()`, an ObjectId variable)
// stay assignable. `object` (not `{}`) is load-bearing: `{}` also accepts
// primitive strings, which would break the replaceRoot "$missing" rejection
// pin. The ref-target arm below keeps the full `Primitive` (Date/ObjectId
// included) so field references still resolve their real types — do NOT widen
// that arm to `PrimitiveLiteralValue`.
type PrimitiveLiteralValue = boolean | number | NoDollarString | object;

export type ResolveToPrimitive<Schema extends Document> =
  Schema extends Document ?
    | PrimitiveLiteralValue
    | FieldReferencesThatInferTo<Schema, Primitive | string>
  : never;

export type ArrayLiterals<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, boolean>[]
  | LiteralOrFieldReferenceInferringTo<Schema, number>[]
  | LiteralOrFieldReferenceInferringTo<Schema, Date>[]
  | (NoDollarString | FieldReferencesThatInferTo<Schema, string>)[];

/**
 * Structurally expression-shaped: carries at least one `$`-prefixed key.
 * Operand validity is deliberately NOT checked here — that is the Validate
 * layer's job. This arm exists so nested computed values inside object
 * literals type-check without paying full `Expression<Schema>` union
 * membership at every literal value.
 */
export type ExpressionShaped = {
  [K in `$${string}`]: unknown;
  // ForbidKeys is load-bearing: without it every plain object is VACUOUSLY
  // expression-shaped (pattern index signatures constrain only matching
  // keys) and this arm would swallow all nested literal checking.
} & ForbidKeys<NoDollarString>;

/**
 * The `$`-key guard: a `$`-prefixed key on the object itself disqualifies
 * it as a literal (MongoDB forbids stored `$`-keys). Without this, a
 * `$`-keyed object is VACUOUSLY assignable to the `NoDollarString` pattern
 * index signature below (pattern indexes don't constrain non-matching
 * keys), which would let invalid expressions pass `$set`/`$project` as
 * "literals".
 */
export type ObjectLiteral<Schema extends Document> = {
  [K in NoDollarString]:
    | ResolveToPrimitive<Schema>
    | ArrayLiterals<Schema>
    | ObjectLiteral<Schema>
    | ExpressionShaped
    // Structural acceptance of nested field-reference strings — including
    // unknown paths, which the Validate walk brands (rejecting them here
    // would go through the deep refs union).
    | `$${string}`;
} & ForbidKeys<`$${string}`>;

export type AnyLiteral<Schema extends Document> =
  | ResolveToPrimitive<Schema>
  | ArrayLiterals<Schema>
  | ObjectLiteral<Schema>;
