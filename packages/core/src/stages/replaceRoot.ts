import { InferNestedFieldReference } from "../elements/fieldReference";
import { Expression } from "../elements/expressions";
import { AnyLiteral } from "../elements/literals";
import { ReferenceValue } from "../elements/variables";
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
 * bindings through it; system variables resolve statically beside it).
 */
export type ReplaceRootQuery<
  Schema extends Document,
  Vars extends Document = {},
> = {
  newRoot:
    | ReferenceValue<Schema, Vars>
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
  Vars extends Document = {},
> = PassThrough<
  Schema,
  Query extends { newRoot: infer NewRoot } ?
    // Wide query (non-literal, or the constraint-failure fallback): skip inference.
    Document extends NewRoot ?
      Document
    : Prettify<InferNestedFieldReference<Schema, NewRoot, Vars>>
  : never
>;
