import { Document, Prettify } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * Resolves the output schema type for a $unionWith stage
 * The output is a union of the current documents and the unioned collection documents.
 * If the schemas are structurally identical, returns just one schema (collapses the union).
 */
export type ResolveUnionWithOutput<
  Schema extends Document,
  PipelineOutput extends Document,
> = PassThrough<
  Schema,
  [Schema] extends [PipelineOutput] ?
    [PipelineOutput] extends [Schema] ?
      Prettify<Schema> // Schemas are identical - collapse to single type
    : Prettify<Schema | PipelineOutput> // Different schemas - union
  : Prettify<Schema | PipelineOutput> // Different schemas - union
>;
