import {
  FieldReference,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral } from "../elements/literals";
import { Document, Prettify } from "../utils/core";

/**
 * $replaceRoot stage query type
 *
 * Replaces the input document with the specified document.
 * The newRoot can be:
 * - A field reference: "$someField"
 * - An expression: { $add: ["$field1", "$field2"] }
 * - A nested object with field references and expressions
 * - A literal value
 */
export type ReplaceRootQuery<Schema extends Document> = {
  newRoot:
    | FieldReference<Schema>
    | Expression<Schema>
    | AnyLiteral<Schema>
    | Document; // For nested objects with field references and expressions
};

/**
 * Resolves the output schema type for a $replaceRoot stage
 * The output is whatever newRoot resolves to
 */
export type ResolveReplaceRootOutput<Query, Schema extends Document> =
  Query extends ReplaceRootQuery<Schema> ?
    Prettify<InferNestedFieldReference<Schema, Query["newRoot"]>>
  : never;
