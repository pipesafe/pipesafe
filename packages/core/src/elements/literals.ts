import { ObjectId } from "mongodb";
import { Document } from "../utils/objects";
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
 * layer's job (§3.8 of docs/type-standardisation-plan.md). This arm exists
 * so nested computed values inside object literals type-check without
 * paying full `Expression<Schema>` union membership at every literal value
 * (measured +26.6% whole-project instantiations vs +12.5% for this shape).
 */
export type ExpressionShaped = {
  [K in `$${string}`]: unknown;
};

/**
 * The `$`-key guard: a `$`-prefixed key on the object itself disqualifies
 * it as a literal (MongoDB forbids stored `$`-keys). Without this, a
 * `$`-keyed object is VACUOUSLY assignable to the `NoDollarString` pattern
 * index signature below (pattern indexes don't constrain non-matching
 * keys), which let invalid expressions slip through `$set`/`$project` as
 * "literals" — the §7.3 bug.
 */
export type ObjectLiteral<Schema extends Document> = {
  [K in NoDollarString]:
    | ResolveToPrimitive<Schema>
    | ArrayLiterals<Schema>
    | ObjectLiteral<Schema>
    | ExpressionShaped;
} & {
  [K in `$${string}`]?: never;
};

export type AnyLiteral<Schema extends Document> =
  | ResolveToPrimitive<Schema>
  | ArrayLiterals<Schema>
  | ObjectLiteral<Schema>;
