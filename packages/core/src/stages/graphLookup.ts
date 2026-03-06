import { Document, Prettify } from "../utils/core";
import { ResolveLookupOutput } from "./lookup";

/**
 * Augments a document type with a depth field when depthField is provided.
 * When DepthField is `never` (default), returns the document unchanged.
 * When DepthField is a string literal, adds `{ [depthField]: number }` to the document.
 */
type GraphLookupElement<Doc extends Document, DepthField extends string> =
  [DepthField] extends [never] ? Doc
  : Prettify<Doc & { [K in DepthField]: number }>;

/**
 * Resolve the output type of a $graphLookup stage.
 *
 * Reuses ResolveLookupOutput from lookup.ts — the only addition is
 * element-level depthField augmentation on the foreign doc type.
 *
 * @template StartingDocs - The current pipeline document schema
 * @template NewKey - The "as" field name where results are stored
 * @template ForeignDoc - The document type of the foreign collection
 * @template DepthField - Optional depth tracking field name (defaults to never)
 */
export type ResolveGraphLookupOutput<
  StartingDocs extends Document,
  NewKey extends string,
  ForeignDoc extends Document,
  DepthField extends string = never,
> = ResolveLookupOutput<
  StartingDocs,
  NewKey,
  GraphLookupElement<ForeignDoc, DepthField>
>;
