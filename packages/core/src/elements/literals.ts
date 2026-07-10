import { ObjectId, Timestamp } from "mongodb";
import { Document, ForbidKeys } from "../utils/objects";
import { NoDollarString } from "../utils/strings";
import {
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

/** Brands (and the bare `never` of e.g. a null-typed path) → `unknown`. */
type DegradeErrorToUnknown<T> =
  [T] extends [PipeSafeError<string>] ? unknown : T;

/** Keep a brand; anything cleanly resolved is valid (`never`). */
type KeepBrand<T> = [T] extends [PipeSafeError<string>] ? T : never;

/**
 * INFERENCE-side resolution of a `$$`-variable reference string, optionally
 * carrying a dotted path ("$$ROOT.name", "$$item.qty"). `Vars` is the
 * variable environment threaded down by the `$let`/`$map`/`$filter` binding
 * arms (names WITHOUT the `$$` prefix); bound names are checked before the
 * system vocabulary (they cannot collide in valid MongoDB — user variable
 * names must begin lowercase). FORGIVING, mirroring InferExpression:
 * anything unresolvable (unknown variable name, bad path, opaque variable
 * type) degrades to `unknown` — never to a wrong type, and never to
 * `never`, which would silently DROP the field from resolvers (rejection is
 * validation's job). The one deliberate `never` is `$$REMOVE`, whose
 * field-dropping IS the MongoDB semantics.
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
 * VALIDATION-side sibling of InferVariableReference — same resolution
 * order, opposite temperament. Contract (matching the validation kernel):
 * `never` = valid, anything else is the branded replacement. Unknown names
 * brand with UnknownSystemVariableError; a dotted path into a known
 * variable resolves through GetFieldTypeWithoutArrays — the same authority
 * inference uses — so a bad path gets the Field brand. Paths into
 * variables whose type is not statically known (opaque system variables,
 * bound variables that themselves degraded to `unknown`) are skipped,
 * mirroring the kernel's wide-schema guards.
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
        never // bound variable of unknown type — nothing to check against
      : KeepBrand<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : `$$${Name}` extends keyof SystemVariableSpec<Schema> ?
      string extends keyof Schema ?
        never // $$ROOT/$$CURRENT paths are meaningless on a wide schema
      : unknown extends SystemVariableSpec<Schema>[`$$${Name}`] ?
        never // opaque variable ($$DESCEND, ...) — nothing to check against
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
 * The `$$`-sibling of FieldReferencesThatInferTo: system variables whose
 * accurate type is assignable to `T`, for typed operand sets ($dateAdd's
 * `startDate` accepts "$$NOW", array operands accept "$$USER_ROLES", ...).
 * Finite (a subset of the enumerated SYSTEM_VARIABLES), so operand unions
 * stay completion-safe. `$$REMOVE`'s `never` is excluded explicitly
 * (`never` is assignable to every target).
 */
export type SystemVariablesThatInferTo<Schema extends Document, T> = {
  [K in SystemVariable]: [SystemVariableSpec<Schema>[K]] extends [never] ? never
  : SystemVariableSpec<Schema>[K] extends T ? K
  : never;
}[SystemVariable];

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
