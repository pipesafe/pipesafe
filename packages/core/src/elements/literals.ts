import { ObjectId } from "mongodb";
import { Document, ForbidKeys } from "../utils/objects";
import { NoDollarString } from "../utils/strings";
import { FieldReferencesThatInferTo } from "./fieldReference";

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
