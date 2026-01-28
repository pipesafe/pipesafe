import { Document, Prettify } from "../utils/core";

/**
 * Resolves the output schema type for a $unionWith stage
 * The output is a union of the current documents and the unioned collection documents.
 * If the schemas are structurally identical, returns just one schema (collapses the union).
 */
export type ResolveUnionWithOutput<
  StartingDocs extends Document,
  PipelineOutput extends Document,
> =
  [StartingDocs] extends [PipelineOutput] ?
    [PipelineOutput] extends [StartingDocs] ?
      Prettify<StartingDocs> // Schemas are identical - collapse to single type
    : Prettify<StartingDocs | PipelineOutput> // Different schemas - union
  : Prettify<StartingDocs | PipelineOutput>; // Different schemas - union
