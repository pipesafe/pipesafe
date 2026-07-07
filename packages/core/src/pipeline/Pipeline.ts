import { pipesafe } from "../singleton/pipesafe";
import { tagClient } from "../singleton/tagClient";
import { Document } from "../utils/objects";
import { WithoutDollar } from "../utils/strings";
import { MatchQuery, ResolveMatchOutput } from "../stages/match";
import { ResolveSetOutput, SetQuery } from "../stages/set";
import { ResolveUnsetOutput, UnsetQuery } from "../stages/unset";
import {
  FieldPath,
  FieldPathsThatInferToForLookup,
  FieldReferencesThatInferTo,
  GetFieldTypeWithoutArrays,
} from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import { Collection } from "../collection/Collection";
import {
  ResolveLookupOutput,
  LookupForeignFieldOrError,
} from "../stages/lookup";
import { ResolveGraphLookupOutput } from "../stages/graphLookup";
import { FacetQuery, ResolveFacetOutput } from "../stages/facet";
import { GetFieldType } from "../elements/fieldSelector";
import {
  GroupQuery,
  ResolveGroupOutput,
  ValidateGroupQuery,
} from "../stages/group";
import { ResolveProjectOutput, ValidateProjectQuery } from "../stages/project";
import {
  ReplaceRootQuery,
  ResolveReplaceRootOutput,
} from "../stages/replaceRoot";
import { ResolveUnionWithOutput } from "../stages/unionWith";
import { SortQuery, ResolveSortOutput } from "../stages/sort";
import { ResolveUnwindOutput, UnwindPath, UnwindQuery } from "../stages/unwind";
import { LimitQuery, ResolveLimitOutput } from "../stages/limit";
import { SkipQuery, ResolveSkipOutput } from "../stages/skip";
import { ResolveSampleOutput, SampleQuery } from "../stages/sample";
import { CountQuery, ResolveCountOutput } from "../stages/count";
import { OutQuery } from "../stages/out";
import { MergeQuery } from "../stages/merge";
import { AggregationCursor, MongoClient } from "mongodb";
import { type Source, type InferSourceType } from "../source/Source";

// ============================================================================
// Lookup Mode - Controls what sources can be used in lookup/unionWith
// ============================================================================

/**
 * Pipeline lookup mode:
 * - "runtime": Only Collection allowed in lookup/unionWith (default, for app code)
 * - "model": Collection OR Model allowed (for DAG/DW pipelines inside Model)
 */
export type LookupMode = "runtime" | "model";

// ============================================================================
// Used Stages - Tracks which pipeline stages have been used
// ============================================================================

/** Public Pipeline members that are not aggregation stage methods */
type PipelineNonStageMethods =
  | "_usedStages"
  | "getPipeline"
  | "getAncestorsFromStages"
  | "custom"
  | "execute";

/** All pipeline stages currently implemented by PipeSafe, derived from the Pipeline class */
type AllPipelineStages =
  `$${Exclude<keyof Pipeline, PipelineNonStageMethods> & string}`;

/** MongoDB stages not yet implemented by PipeSafe but needed for sub-pipeline restrictions */
type KnownUnimplementedStages =
  | "$changeStream"
  | "$changeStreamSplitLargeEvent"
  | "$collStats"
  | "$geoNear"
  | "$indexStats"
  | "$planCacheStats"
  | "$search"
  | "$searchMeta"
  | "$vectorSearch";

/** Type-safe exclusion: constrains excluded stages to implemented or known-unimplemented names */
type AllPipelineStagesExcept<
  T extends AllPipelineStages | KnownUnimplementedStages,
> = Exclude<AllPipelineStages, T>;

/** Stages allowed inside $lookup sub-pipelines (per MongoDB docs) */
export type LookupAllowedStages = AllPipelineStagesExcept<
  | "$out"
  | "$merge"
  | "$geoNear"
  | "$changeStream"
  | "$changeStreamSplitLargeEvent"
>;

/** Stages allowed inside $unionWith sub-pipelines (per MongoDB docs) */
export type UnionWithAllowedStages = AllPipelineStagesExcept<"$out" | "$merge">;

/** Stages allowed inside $facet sub-pipelines (per MongoDB docs) */
export type FacetAllowedStages = AllPipelineStagesExcept<
  | "$collStats"
  | "$facet"
  | "$geoNear"
  | "$indexStats"
  | "$out"
  | "$merge"
  | "$planCacheStats"
  | "$search"
  | "$searchMeta"
  | "$vectorSearch"
>;

type AllowedSource<Mode extends LookupMode, T extends Document> =
  Mode extends "model" ? Source<T> : Collection<T>;

/**
 * Helper to create pipeline functions with proper typing.
 * AllowedStages constrains which stages the sub-pipeline may use.
 * Defaults to `string` (no restriction) for top-level / standalone builders.
 */
export type PipelineBuilder<
  D extends Document,
  O extends Document,
  Mode extends LookupMode = "runtime",
  AllowedStages extends string = string,
> = (p: Pipeline<D, D, Mode, never>) => Pipeline<D, O, Mode, AllowedStages>;

export class Pipeline<
  StartingDocs extends Document = never,
  PreviousStageDocs extends Document = StartingDocs,
  Mode extends LookupMode = "runtime",
  UsedStages extends string = never,
> {
  /** @internal Phantom brand for stage tracking enforcement */
  declare readonly _usedStages: UsedStages;

  private pipeline: Document[] = [];
  getPipeline(): PreviousStageDocs extends never ? never : Document[] {
    return this.pipeline as PreviousStageDocs extends never ? never
    : Document[];
  }

  /** Tracks ancestor sources from lookup/unionWith stages */
  private readonly _ancestorsFromStages: Source<any>[] = [];

  /** Get all ancestor sources referenced in lookup/unionWith stages */
  getAncestorsFromStages(): Source<any>[] {
    return this._ancestorsFromStages;
  }

  private client: MongoClient | undefined;
  private databaseName: string | undefined;
  private collectionName: string | undefined;

  constructor(
    args: {
      pipeline?: Document[] | undefined;
      client?: MongoClient | undefined;
      collectionName?: string | undefined;
      databaseName?: string | undefined;
    } = {}
  ) {
    this.pipeline = args.pipeline ?? [];
    this.client = args.client;
    this.collectionName = args.collectionName;
    this.databaseName = args.databaseName;
    tagClient(this.client);
  }

  /** Create a chained pipeline that carries forward ancestor sources */
  private _chain<NewOutput extends Document, NewStage extends string = never>(
    newStages: Document[],
    additionalAncestors: Source<any>[] = []
  ): Pipeline<StartingDocs, NewOutput, Mode, UsedStages | NewStage> {
    const next = new Pipeline<
      StartingDocs,
      NewOutput,
      Mode,
      UsedStages | NewStage
    >({
      pipeline: [...this.pipeline, ...newStages],
      client: this.client,
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
    next._ancestorsFromStages.push(
      ...this._ancestorsFromStages,
      ...additionalAncestors
    );
    return next;
  }

  // Ability to use any aggregation stage(s) and manually type the output
  custom<CustomOutput extends Document>(pipelineStages: Document[]) {
    return this._chain<CustomOutput>(pipelineStages);
  }

  // $match step
  match<const M extends MatchQuery<PreviousStageDocs>>(
    $match: M
  ): Pipeline<
    StartingDocs,
    ResolveMatchOutput<PreviousStageDocs, M>,
    Mode,
    UsedStages | "$match"
  > {
    return this._chain<ResolveMatchOutput<PreviousStageDocs, M>, "$match">([
      { $match },
    ]);
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): Pipeline<
    StartingDocs,
    ResolveSetOutput<PreviousStageDocs, S>,
    Mode,
    UsedStages | "$set"
  > {
    return this._chain<ResolveSetOutput<PreviousStageDocs, S>, "$set">([
      { $set },
    ]);
  }

  unset<const U extends UnsetQuery<PreviousStageDocs>>(
    $unset: U
  ): Pipeline<
    StartingDocs,
    ResolveUnsetOutput<PreviousStageDocs, U>,
    Mode,
    UsedStages | "$unset"
  > {
    return this._chain<ResolveUnsetOutput<PreviousStageDocs, U>, "$unset">([
      { $unset },
    ]);
  }

  lookup<
    C extends AllowedSource<Mode, any>,
    LocalField extends FieldPath<PreviousStageDocs>,
    LocalFieldType extends GetFieldType<PreviousStageDocs, LocalField>,
    // MongoDB's $lookup matches array elements against scalars in either
    // direction. `LookupForeignFieldOrError` (in stages/lookup.ts) covers
    // all four T/T[] combinations and falls through to a branded
    // `PipeSafeError` when no foreign field has a compatible type —
    // surfacing a clear hover instead of "is not assignable to never".
    ForeignField extends LookupForeignFieldOrError<
      InferSourceType<C>,
      LocalFieldType,
      LocalField
    >,
    NewKey extends string,
    PipelineOutput extends Document = InferSourceType<C>,
  >(
    $lookup:
      | {
          from: C;
          localField: LocalField;
          foreignField: ForeignField;
          as: NewKey;
          pipeline?: PipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode,
            LookupAllowedStages
          >;
        }
      | {
          from: C;
          as: NewKey;
          pipeline: PipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode,
            LookupAllowedStages
          >;
        }
  ): Pipeline<
    StartingDocs,
    ResolveLookupOutput<PreviousStageDocs, NewKey, PipelineOutput>,
    Mode,
    UsedStages | "$lookup"
  > {
    const { from, pipeline, ...$lookupRest } = $lookup;

    // Get collection name from source
    const collectionName = (from as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        (pipeline as PipelineBuilder<any, any, any, any>)(
          new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode, never>({
            collectionName,
          })
        )
      : undefined;

    // Include the lookup source + any ancestors from the sub-pipeline
    const ancestors: Source<any>[] = [from as Source<any>];
    if (resolvedPipeline) {
      ancestors.push(...resolvedPipeline.getAncestorsFromStages());
    }

    return this._chain<
      ResolveLookupOutput<PreviousStageDocs, NewKey, PipelineOutput>,
      "$lookup"
    >(
      [
        {
          $lookup: {
            from: collectionName,
            ...$lookupRest,
            ...(resolvedPipeline && {
              pipeline: resolvedPipeline.getPipeline(),
            }),
          },
        },
      ],
      ancestors
    );
  }

  graphLookup<
    C extends AllowedSource<Mode, any>,
    ConnectToField extends FieldPath<InferSourceType<C>>,
    ConnectToFieldType extends GetFieldTypeWithoutArrays<
      InferSourceType<C>,
      ConnectToField
    >,
    ConnectFromField extends
      | FieldPathsThatInferToForLookup<
          InferSourceType<C>,
          ConnectToFieldType extends string ? string : ConnectToFieldType
        >
      | FieldPathsThatInferToForLookup<InferSourceType<C>, ConnectToFieldType>
      | FieldPathsThatInferToForLookup<
          InferSourceType<C>,
          ConnectToFieldType[]
        >,
    StartWith extends
      | FieldReferencesThatInferTo<PreviousStageDocs, ConnectToFieldType>
      | FieldReferencesThatInferTo<PreviousStageDocs, ConnectToFieldType[]>
      | ConnectToFieldType
      | (Expression<PreviousStageDocs> &
          (InferExpression<PreviousStageDocs, StartWith> extends (
            ConnectToFieldType
          ) ?
            unknown
          : never)),
    NewKey extends string,
    DepthField extends string = never,
    const RestrictMatch extends MatchQuery<InferSourceType<C>> = never,
  >($graphLookup: {
    from: C;
    startWith: StartWith;
    connectFromField: ConnectFromField;
    connectToField: ConnectToField;
    as: NewKey;
    maxDepth?: number;
    depthField?: DepthField;
    restrictSearchWithMatch?: RestrictMatch;
  }): Pipeline<
    StartingDocs,
    ResolveGraphLookupOutput<
      PreviousStageDocs,
      NewKey,
      InferSourceType<C>,
      DepthField,
      RestrictMatch
    >,
    Mode,
    UsedStages | "$graphLookup"
  > {
    const { from, ...rest } = $graphLookup;

    const collectionName = (from as Source<any>).getOutputCollectionName();

    return this._chain<
      ResolveGraphLookupOutput<
        PreviousStageDocs,
        NewKey,
        InferSourceType<C>,
        DepthField,
        RestrictMatch
      >,
      "$graphLookup"
    >(
      [
        {
          $graphLookup: {
            from: collectionName,
            ...rest,
          },
        },
      ],
      [from as Source<any>]
    );
  }

  // The intersection parameter keeps `G` as the inference/contextual-typing
  // position (compound `_id` expressions break under a bare mapped wrapper)
  // while ValidateGroupQuery re-checks accumulator operands — key-filtered,
  // so a fully-valid query validates against `{}` (see stages/group.ts).
  group<const G extends GroupQuery<PreviousStageDocs>>(
    $group: G & ValidateGroupQuery<PreviousStageDocs, G>
  ): Pipeline<
    StartingDocs,
    ResolveGroupOutput<PreviousStageDocs, G>,
    Mode,
    UsedStages | "$group"
  > {
    return this._chain<ResolveGroupOutput<PreviousStageDocs, G>, "$group">([
      { $group },
    ]);
  }

  // The validate and resolve positions each compute the projection modes
  // via their defaulted parameters; the second computation is an alias-cache
  // hit, so hoisting them into method generics would buy nothing.
  project<const P>(
    $project: ValidateProjectQuery<PreviousStageDocs, P>
  ): Pipeline<
    StartingDocs,
    ResolveProjectOutput<PreviousStageDocs, P>,
    Mode,
    UsedStages | "$project"
  > {
    return this._chain<ResolveProjectOutput<PreviousStageDocs, P>, "$project">([
      { $project },
    ]);
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): Pipeline<
    StartingDocs,
    ResolveReplaceRootOutput<PreviousStageDocs, R>,
    Mode,
    UsedStages | "$replaceRoot"
  > {
    return this._chain<
      ResolveReplaceRootOutput<PreviousStageDocs, R>,
      "$replaceRoot"
    >([{ $replaceRoot }]);
  }

  /**
   * Sort documents by field values (ascending 1 or descending -1)
   * @example .sort({ createdAt: -1, name: 1 })
   */
  sort(
    $sort: SortQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveSortOutput<PreviousStageDocs>,
    Mode,
    UsedStages | "$sort"
  > {
    return this._chain<ResolveSortOutput<PreviousStageDocs>, "$sort">([
      { $sort },
    ]);
  }

  /**
   * Limit the number of documents in the pipeline
   * @example .limit(10)
   */
  limit(
    n: LimitQuery
  ): Pipeline<
    StartingDocs,
    ResolveLimitOutput<PreviousStageDocs>,
    Mode,
    UsedStages | "$limit"
  > {
    return this._chain<ResolveLimitOutput<PreviousStageDocs>, "$limit">([
      { $limit: n },
    ]);
  }

  /**
   * Skip a number of documents
   * @example .skip(20).limit(10)
   */
  skip(
    n: SkipQuery
  ): Pipeline<
    StartingDocs,
    ResolveSkipOutput<PreviousStageDocs>,
    Mode,
    UsedStages | "$skip"
  > {
    return this._chain<ResolveSkipOutput<PreviousStageDocs>, "$skip">([
      { $skip: n },
    ]);
  }

  /**
   * Randomly select a fixed-size sample of documents from the pipeline.
   * @example .sample({ size: 10 })
   */
  sample(
    $sample: SampleQuery
  ): Pipeline<
    StartingDocs,
    ResolveSampleOutput<PreviousStageDocs>,
    Mode,
    UsedStages | "$sample"
  > {
    return this._chain<ResolveSampleOutput<PreviousStageDocs>, "$sample">([
      { $sample },
    ]);
  }

  /**
   * Replace the pipeline with a single document containing the document count
   * under the given field name.
   * @example .count("total") // → { total: number }
   */
  count<F extends CountQuery>(
    fieldName: F
  ): Pipeline<
    StartingDocs,
    ResolveCountOutput<PreviousStageDocs, F>,
    Mode,
    UsedStages | "$count"
  > {
    return this._chain<ResolveCountOutput<PreviousStageDocs, F>, "$count">([
      { $count: fieldName },
    ]);
  }

  /**
   * Deconstruct an array field into multiple documents (T[] → T)
   * @example .unwind("$items") or .unwind({ path: "$items", includeArrayIndex: "idx" })
   */
  unwind<
    // Constrained to UnwindPath (not the raw FieldReferencesThatInferTo) so
    // the module's branded error arm surfaces in hovers at the call site.
    Path extends UnwindPath<PreviousStageDocs>,
    IndexField extends string = never,
  >(
    $unwind: UnwindQuery<PreviousStageDocs, Path, IndexField>
  ): Pipeline<
    StartingDocs,
    ResolveUnwindOutput<
      PreviousStageDocs,
      WithoutDollar<Path & string>,
      IndexField
    >,
    Mode,
    UsedStages | "$unwind"
  > {
    return this._chain<
      ResolveUnwindOutput<
        PreviousStageDocs,
        WithoutDollar<Path & string>,
        IndexField
      >,
      "$unwind"
    >([{ $unwind }]);
  }

  unionWith<
    C extends AllowedSource<Mode, any>,
    PipelineOutput extends Document = InferSourceType<C>,
  >(
    $unionWith:
      | {
          coll: C;
          pipeline?: PipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode,
            UnionWithAllowedStages
          >;
        }
      | {
          coll: C;
          pipeline: PipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode,
            UnionWithAllowedStages
          >;
        }
  ): Pipeline<
    StartingDocs,
    ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>,
    Mode,
    UsedStages | "$unionWith"
  > {
    const { coll, pipeline } = $unionWith;

    // Get collection name from source
    const collectionName = (coll as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        (pipeline as PipelineBuilder<any, any, any, any>)(
          new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode, never>()
        )
      : undefined;

    // Include the unionWith source + any ancestors from the sub-pipeline
    const ancestors: Source<any>[] = [coll as Source<any>];
    if (resolvedPipeline) {
      ancestors.push(...resolvedPipeline.getAncestorsFromStages());
    }

    return this._chain<
      ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>,
      "$unionWith"
    >(
      [
        {
          $unionWith: {
            coll: collectionName,
            ...(resolvedPipeline && {
              pipeline: resolvedPipeline.getPipeline(),
            }),
          },
        },
      ],
      ancestors
    );
  }

  /**
   * Process the same input documents through multiple independent sub-pipelines
   * and return a single document where each key maps to its sub-pipeline's result array.
   *
   * @example
   * .facet({
   *   priceSummary: (p) => p.group({ _id: null, avg: { $avg: "$price" } }),
   *   topItems: (p) => p.sort({ price: -1 }).limit(5),
   * })
   */
  facet<const F extends FacetQuery<PreviousStageDocs, Mode>>(
    $facet: F
  ): Pipeline<
    StartingDocs,
    ResolveFacetOutput<PreviousStageDocs, F>,
    Mode,
    UsedStages | "$facet"
  > {
    const facetStage: Record<string, Document[]> = {};
    const ancestors: Source<any>[] = [];

    for (const [key, builder] of Object.entries($facet)) {
      const subPipeline = (builder as PipelineBuilder<any, any, any, any>)(
        new Pipeline<PreviousStageDocs, PreviousStageDocs, Mode, never>()
      );
      facetStage[key] = subPipeline.getPipeline();
      ancestors.push(...subPipeline.getAncestorsFromStages());
    }

    return this._chain<ResolveFacetOutput<PreviousStageDocs, F>, "$facet">(
      [{ $facet: facetStage }],
      ancestors
    );
  }

  out($out: OutQuery<PreviousStageDocs>) {
    return this._chain<never, "$out">([{ $out }]);
  }

  /**
   * Write or merge documents into a collection (terminal stage).
   *
   * Like {@link out}, no further pipeline stages can follow `$merge`:
   * the returned pipeline narrows `PreviousStageDocs` to `never`.
   *
   * @example
   * .merge({ into: "metrics", on: "_id", whenMatched: "merge" })
   *
   * @example // Cross-database
   * .merge({ into: { db: "analytics", coll: "metrics" } })
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
   */
  merge(
    $merge: MergeQuery<PreviousStageDocs>
  ): Pipeline<StartingDocs, never, Mode, UsedStages | "$merge"> {
    return this._chain<never, "$merge">([{ $merge }]);
  }

  execute(
    args: {
      client?: MongoClient;
      databaseName?: string;
      collectionName?: string;
    } = {}
  ): AggregationCursor<PreviousStageDocs> {
    const client = args.client ?? this.client ?? pipesafe.client;
    if (!client) throw new Error("Not connected");
    tagClient(client);

    const db = args.databaseName ?? this.databaseName;

    const collection = args.collectionName ?? this.collectionName;
    if (!collection) throw new Error("No collection name provided");

    return client.db(db).collection(collection).aggregate(this.getPipeline());
  }
}

export type InferOutputType<P extends Pipeline<any, any, any, any>> =
  P extends Pipeline<any, infer Output, any, any> ? Output : never;
