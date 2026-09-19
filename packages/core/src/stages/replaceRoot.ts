import {
  FieldReference,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral, SystemVariable } from "../elements/literals";
import { Document, Prettify } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * $replaceRoot stage query type
 *
 * Replaces the input document with the specified document.
 * The newRoot can be:
 * - A field reference: "$someField"
 * - An enumerated `$$`-system variable: "$$ROOT", "$$CURRENT", ...
 * - An expression: { $add: ["$field1", "$field2"] }
 * - A nested object with field references and expressions
 * - A literal value
 */
export type ReplaceRootQuery<Schema extends Document> = {
  newRoot:
    | FieldReference<Schema>
    | SystemVariable
    | Expression<Schema>
    | AnyLiteral<Schema>
    | Document; // For nested objects with field references and expressions
};

/**
 * Resolves the output schema type for a $replaceRoot stage
 * The output is whatever newRoot resolves to.
 *
 * Narrowing uses a cheap single-key structural check instead of a full
 * `Query extends ReplaceRootQuery<Schema>` re-match — the method's
 * parameter position already validated the query.
 */
export type ResolveReplaceRootOutput<
  Schema extends Document,
  Query,
> = PassThrough<
  Schema,
  Query extends { newRoot: infer NewRoot } ?
    Prettify<InferNestedFieldReference<Schema, NewRoot>>
  : never
>;
