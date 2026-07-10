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
 * AUTHORITATIVE list (never widen a consumer to `` `$$${string}` `` where a
 * finite vocabulary is wanted). Finite literals are primitive-flagged, so
 * they autocomplete at string-value positions without absorbing sibling
 * literals and contribute nothing to object-literal key completions. An
 * unlisted `$$var` at a position typed with this union is rejected at the
 * constraint (undefined variables are runtime errors in MongoDB anyway);
 * `$let`/`$map`/`$filter`-bound USER variables resolve through the `Vars`
 * environment their binding arms thread down (see InferVariableReference).
 * The `satisfies` ties the list to SystemVariableSpec: adding a variable
 * here without its accurate type fails at this declaration.
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
 * Accurate result type of each system variable — the object-shaped
 * companion of SYSTEM_VARIABLES (the array stays AUTHORITATIVE via its
 * `satisfies`). `$$ROOT`/`$$CURRENT` are the current document (`$$CURRENT`
 * rebinding is not modeled); `$$REMOVE`'s `never` is load-bearing — the
 * resolvers strip never-typed fields, which IS the $$REMOVE semantics;
 * `$$DESCEND`/`$$PRUNE`/`$$KEEP` are opaque `$redact` action markers
 * (`unknown`); `$$SEARCH_META`'s shape depends on the search query, so it
 * stays a wide unknown-VALUED document — NOT `Document` (= `Record<string,
 * any>`): an `any`-valued index signature is structurally assignable to
 * Date & friends and would corrupt SystemVariablesThatInferTo.
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
 * THE variable ENVIRONMENT seed: every system variable, keyed by NAME
 * (without the `$$` prefix) — derived from SystemVariableSpec by key remap.
 * There is exactly ONE variable-threading mechanism in the library: every
 * `Vars` parameter defaults to this seed, `$let`/`$map`/`$filter` binding
 * arms EXTEND it (BindVariable/BindLetVars in expressions.ts), and
 * `$lookup.let` sub-pipelines reseed it over the foreign schema with the
 * `let` bindings layered on (Pipeline's `Env` generic + PipelineVars).
 * Resolution is a single env lookup — system and user variables are not
 * separate code paths.
 */
export type SystemVariables<Schema extends Document> = {
  [K in keyof SystemVariableSpec<Schema> as K extends `$$${infer Name}` ? Name
  : never]: SystemVariableSpec<Schema>[K];
};

/** The seed's names — schema-independent (the mapped-as keys don't depend
 * on Schema). User bindings can never collide: MongoDB requires user
 * variable names to begin lowercase. */
export type SystemVariableName = keyof SystemVariables<Document>;

/**
 * `true` when the environment carries USER bindings on top of the seed —
 * i.e. we are inside a `$let`/`$map`/`$filter` interior or a `$lookup.let`
 * sub-pipeline. The validation kernel forks on this: registry operand
 * relations are Vars-blind, so they are skipped in favor of a name/ref walk
 * wherever a bound `$$var` could appear inside an operand.
 */
export type HasUserBindings<Vars extends Document> =
  [Exclude<keyof Vars, SystemVariableName>] extends [never] ? false : true;

/**
 * The environment a Pipeline stage validates/infers under: the seed for the
 * stage's CURRENT schema, with the Pipeline's user `Env` (from an enclosing
 * `$lookup.let`) layered on. The empty-Env fast path returns the plain seed
 * so ordinary pipelines share one alias-cache entry per schema.
 */
export type PipelineVars<Schema extends Document, Env extends Document> =
  [keyof Env] extends [never] ? SystemVariables<Schema>
  : // ONE mapped type, values resolved lazily on key access — an
    // Omit/Prettify spelling stacks extra instantiation layers, and this
    // type is evaluated at the DEEPEST point of lookup-lambda checking
    // (first evaluation of a merged env happens inside the sub-builder).
    {
      [K in keyof SystemVariables<Schema> | keyof Env]: K extends keyof Env ?
        Env[K]
      : K extends keyof SystemVariables<Schema> ? SystemVariables<Schema>[K]
      : never;
    };

/**
 * The finite `$$`-reference VOCABULARY of an environment — the acceptance
 * companion of the resolvers below, used by top-level value unions
 * (set/project/group/replaceRoot) so every in-scope variable autocompletes
 * and an out-of-scope one rejects at the constraint with TS's native
 * spelling suggestion. Each entry contributes its exact name plus dotted
 * paths into its type ("$$ROOT.name", "$$order.qty" for a lookup-let
 * binding). Wide-keyed entries ($$SEARCH_META) contribute no dotted arm —
 * `string extends FieldPath<...>` would create a banned wide template —
 * and unknown-typed ones (FieldPath<unknown> = never) none either.
 */
export type VariableReferences<Vars extends Document> = {
  [K in keyof Vars & string]:
    | `$$${K}`
    | (string extends FieldPath<Vars[K]> ? never
      : `$$${K}.${FieldPath<Vars[K]>}`);
}[keyof Vars & string];

/** Brands (and the bare `never` of e.g. a null-typed path) → `unknown`. */
type DegradeErrorToUnknown<T> =
  [T] extends [PipeSafeError<string>] ? unknown : T;

/** Keep a brand; anything cleanly resolved is valid (`never`). */
type KeepBrand<T> = [T] extends [PipeSafeError<string>] ? T : never;

/**
 * INFERENCE-side resolution of a `$$`-variable reference string, optionally
 * carrying a dotted path ("$$ROOT.name", "$$item.qty"), against the ONE
 * environment (`Vars`, defaulting to the system seed). FORGIVING, mirroring
 * InferExpression: anything unresolvable (unknown variable name, bad path,
 * opaque variable type) degrades to `unknown` — never to a wrong type, and
 * never to `never`, which would silently DROP the field from resolvers
 * (rejection is validation's job). The one deliberate `never` is `$$REMOVE`,
 * whose field-dropping IS the MongoDB semantics (carried by the seed).
 */
export type InferVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = SystemVariables<Schema>,
> =
  V extends `$$${infer Name}.${infer Path}` ?
    Name extends keyof Vars ?
      DegradeErrorToUnknown<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : unknown
  : V extends `$$${infer Name}` ?
    Name extends keyof Vars ?
      Vars[Name]
    : unknown
  : never;

/**
 * VALIDATION-side sibling of InferVariableReference — same single-lookup
 * resolution, opposite temperament. Contract (matching the validation
 * kernel): `never` = valid, anything else is the branded replacement.
 * Unknown names brand with UnknownSystemVariableError; a dotted path into a
 * known variable resolves through GetFieldTypeWithoutArrays — the same
 * authority inference uses — so a bad path gets the Field brand. Paths into
 * variables whose type is not statically known (opaque system variables,
 * bound variables that themselves degraded to `unknown`) are skipped.
 */
export type ValidateVariableReference<
  Schema extends Document,
  V extends string,
  Vars extends Document = SystemVariables<Schema>,
> =
  V extends `$$${infer Name}.${infer Path}` ?
    Name extends keyof Vars ?
      unknown extends Vars[Name] ?
        never // variable of statically unknown type — nothing to check
      : KeepBrand<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : UnknownSystemVariableError<`$$${Name}`>
  : V extends `$$${infer Name}` ?
    Name extends keyof Vars ?
      never
    : UnknownSystemVariableError<V>
  : never;

/**
 * The `$$`-sibling of FieldReferencesThatInferTo: variable references whose
 * accurate type is assignable to `T`, for typed operand sets ($dateAdd's
 * `startDate` accepts "$$NOW", array operands accept "$$USER_ROLES", a
 * numeric operand accepts "$$ROOT.price"). The dotted arms REUSE the
 * schema's cached ref→type map (FieldReferencesThatInferTo) via prefix
 * rewrite instead of building a second map. All arms are finite, so operand
 * unions stay completion-safe. `$$REMOVE`'s `never` is excluded explicitly
 * (`never` is assignable to every target). Operand sets are registry-level
 * (Vars-blind) by design: inside binder/lookup-let interiors the operand
 * relation is skipped entirely, so bound names never reach these sets.
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
