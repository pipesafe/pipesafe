import { Document, Prettify } from "../utils/core";
import { ResolveLookupOutput } from "./lookup";
import { MatchQuery, ResolveMatchOutput } from "./match";

/**
 * Augments a document type with a depth field when depthField is provided.
 * When DepthField is `never` (default), returns the document unchanged.
 * When DepthField is a string literal, adds `{ [depthField]: number }` to the document.
 */
type GraphLookupElement<Doc extends Document, DepthField extends string> =
  [DepthField] extends [never] ? Doc
  : Prettify<Doc & { [K in DepthField]: number }>;

/**
 * Narrows the foreign doc type when restrictSearchWithMatch is provided.
 * When RestrictMatch is `never` (default), returns ForeignDoc unchanged.
 * Otherwise applies the same union-narrowing logic as $match.
 */
type NarrowForeignDoc<ForeignDoc extends Document, RestrictMatch> =
  [RestrictMatch] extends [never] ? ForeignDoc
  : RestrictMatch extends MatchQuery<ForeignDoc> ?
    ResolveMatchOutput<RestrictMatch, ForeignDoc>
  : ForeignDoc;

/**
 * Resolve the output type of a $graphLookup stage.
 *
 * Reuses ResolveLookupOutput from lookup.ts — additions are
 * element-level depthField augmentation and restrictSearchWithMatch narrowing.
 *
 * @template StartingDocs - The current pipeline document schema
 * @template NewKey - The "as" field name where results are stored
 * @template ForeignDoc - The document type of the foreign collection
 * @template DepthField - Optional depth tracking field name (defaults to never)
 * @template RestrictMatch - Optional restrictSearchWithMatch query (defaults to never)
 */
export type ResolveGraphLookupOutput<
  StartingDocs extends Document,
  NewKey extends string,
  ForeignDoc extends Document,
  DepthField extends string = never,
  RestrictMatch = never,
> = ResolveLookupOutput<
  StartingDocs,
  NewKey,
  GraphLookupElement<NarrowForeignDoc<ForeignDoc, RestrictMatch>, DepthField>
>;
