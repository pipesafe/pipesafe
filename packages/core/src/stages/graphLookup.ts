import { Document, Prettify } from "../utils/objects";
import { ResolveLookupOutput } from "./lookup";
import { ResolveMatchOutput } from "./match";

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
 * When RestrictMatch is `never` (default), returns Foreign unchanged.
 * Otherwise applies the same union-narrowing logic as $match. No
 * `extends MatchQuery` re-prove: Pipeline.graphLookup's constraint already
 * validated RestrictMatch (re-proving here re-instantiated the full
 * MatchQuery union per call and silently fell back to the UNFILTERED
 * Foreign on mismatch instead of branding).
 */
type NarrowForeignDoc<Foreign extends Document, RestrictMatch> =
  [RestrictMatch] extends [never] ? Foreign
  : ResolveMatchOutput<Foreign, RestrictMatch>;

/**
 * Resolve the output type of a $graphLookup stage.
 *
 * Reuses ResolveLookupOutput from lookup.ts — additions are
 * element-level depthField augmentation and restrictSearchWithMatch narrowing.
 *
 * @template Schema - The current pipeline document schema
 * @template NewKey - The "as" field name where results are stored
 * @template Foreign - The document type of the foreign collection
 * @template DepthField - Optional depth tracking field name (defaults to never)
 * @template RestrictMatch - Optional restrictSearchWithMatch query (defaults to never)
 */
export type ResolveGraphLookupOutput<
  Schema extends Document,
  NewKey extends string,
  Foreign extends Document,
  DepthField extends string = never,
  RestrictMatch = never,
> = ResolveLookupOutput<
  Schema,
  NewKey,
  GraphLookupElement<NarrowForeignDoc<Foreign, RestrictMatch>, DepthField>
>;
