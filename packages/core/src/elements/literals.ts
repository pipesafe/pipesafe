import { ObjectId } from "mongodb";
import { Document, ForbidKeys } from "../utils/objects";
import { NoDollarString } from "../utils/strings";
import { FieldReferencesThatInferTo } from "./fieldReference";

export type LiteralOrFieldReferenceInferringTo<Schema extends Document, T> =
  | T
  | FieldReferencesThatInferTo<Schema, T>;

type Primitive = boolean | number | Date | NoDollarString | ObjectId;

export type ResolveToPrimitive<Schema extends Document> =
  Schema extends Document ?
    Primitive | FieldReferencesThatInferTo<Schema, Primitive | string>
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
