import {
  FieldReference,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import {
  AnyLiteral,
  SystemVariables,
  VariableReferences,
} from "../elements/literals";
import { Document, Prettify } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * $replaceRoot stage query type
 *
 * Replaces the input document with the specified document.
 * The newRoot can be:
 * - A field reference: "$someField"
 * - A `$$`-variable reference from the environment: "$$ROOT",
 *   "$$ROOT.shipping", a lookup-let binding, ...
 * - An expression: { $add: ["$field1", "$field2"] }
 * - A nested object with field references and expressions
 * - A literal value
 *
 * `Vars` is the stage's variable environment (Pipeline threads lookup-let
 * bindings through it; defaults to the system seed).
 */
export type ReplaceRootQuery<
  Schema extends Document,
  Vars extends Document = SystemVariables<Schema>,
> = {
  newRoot:
    | FieldReference<Schema>
    | VariableReferences<Vars>
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
  Vars extends Document = SystemVariables<Schema>,
> = PassThrough<
  Schema,
  Query extends { newRoot: infer NewRoot } ?
    Prettify<InferNestedFieldReference<Schema, NewRoot, Vars>>
  : never
>;
