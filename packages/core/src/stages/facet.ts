import { Document, Prettify } from "../utils/objects";
import { PassThrough } from "../utils/errors";
import type {
  LookupMode,
  PipelineBuilder,
  FacetAllowedStages,
} from "../pipeline/Pipeline";

/**
 * Input type for $facet — a record of named sub-pipelines.
 * Each key maps to a PipelineBuilder that transforms Schema into some output type.
 * Sub-pipelines are constrained to FacetAllowedStages. `Env` propagates the
 * enclosing pipeline's lookup-let bindings into the sub-builders (facet
 * processes the SAME documents, so the enclosing variables stay in scope).
 */
export type FacetQuery<
  Schema extends Document,
  Mode extends LookupMode,
  Env extends Document = {},
> = Record<
  string,
  PipelineBuilder<Schema, Document, Mode, FacetAllowedStages, Env>
>;

/**
 * Resolve the output type of a $facet stage.
 *
 * $facet always produces a single document where each key holds an array
 * of documents from its sub-pipeline's output.
 *
 * @template Schema - The current pipeline document schema
 * @template F - The facet query record mapping keys to sub-pipelines
 */
export type ResolveFacetOutput<
  Schema extends Document,
  F extends FacetQuery<Schema, any, any>,
> = PassThrough<
  Schema,
  Prettify<{
    [K in keyof F]: F[K] extends PipelineBuilder<any, infer O, any, any, any> ?
      O[]
    : never;
  }>
>;
