import { Document, Prettify } from "../utils/core";
import type { LookupMode, PipelineBuilder } from "../pipeline/Pipeline";

/**
 * Input type for $facet — a record of named sub-pipelines.
 * Each key maps to a PipelineBuilder that transforms PreviousStageDocs into some output type.
 */
export type FacetQuery<
  PreviousStageDocs extends Document,
  Mode extends LookupMode,
> = Record<string, PipelineBuilder<PreviousStageDocs, Document, Mode>>;

/**
 * Resolve the output type of a $facet stage.
 *
 * $facet always produces a single document where each key holds an array
 * of documents from its sub-pipeline's output.
 *
 * @template PreviousStageDocs - The current pipeline document schema
 * @template F - The facet query record mapping keys to sub-pipelines
 */
export type ResolveFacetOutput<
  PreviousStageDocs extends Document,
  F extends FacetQuery<PreviousStageDocs, any>,
> = Prettify<{
  [K in keyof F]: F[K] extends PipelineBuilder<any, infer O, any> ? O[] : never;
}>;
