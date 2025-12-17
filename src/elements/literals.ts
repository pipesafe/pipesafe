import { ObjectId } from "mongodb";
import { Document, NoDollarString } from "../utils/core";
import { FieldReferencesThatInferTo } from "./fieldReference";

export type LiteralOrFieldReferenceInferringTo<Schema extends Document, T> =
  | T
  | FieldReferencesThatInferTo<Schema, T>;

type Primitive = boolean | number | Date | NoDollarString | ObjectId;

export type ResolveToPrimitive<Schema extends Document> =
  Schema extends Document ?
    Primitive | FieldReferencesThatInferTo<Schema, Primitive | string>
  : never;

export type ResolveToPrimitiveObjectArray<Schema extends Document> =
  ResolveToPrimitiveObject<Schema>[];

export type ResolveToPrimitiveArray<Schema extends Document> =
  ResolveToPrimitive<Schema>[];

export type ResolveToPrimitiveObject<Schema extends Document> = {
  [K in string]:
    | ResolveToPrimitive<Schema>
    | ResolveToPrimitiveArray<Schema>
    | ResolveToPrimitiveObject<Schema>
    | ResolveToPrimitiveObjectArray<Schema>;
};

export type ArrayLiterals<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, boolean>[]
  | LiteralOrFieldReferenceInferringTo<Schema, number>[]
  | LiteralOrFieldReferenceInferringTo<Schema, Date>[]
  | (NoDollarString | FieldReferencesThatInferTo<Schema, string>)[];

export type ObjectLiteral<Schema extends Document> = {
  [K in NoDollarString]:
    | ResolveToPrimitive<Schema>
    | ArrayLiterals<Schema>
    | ObjectLiteral<Schema>;
};

export type AnyLiteral<Schema extends Document> =
  | ResolveToPrimitive<Schema>
  | ArrayLiterals<Schema>
  | ObjectLiteral<Schema>;
