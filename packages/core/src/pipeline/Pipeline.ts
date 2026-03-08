import { pipesafe } from "../singleton/pipesafe";
import { Document, WithoutDollar } from "../utils/core";
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
import { ResolveLookupOutput } from "../stages/lookup";
import { ResolveGraphLookupOutput } from "../stages/graphLookup";
import { FacetQuery, ResolveFacetOutput } from "../stages/facet";
import { GetFieldType } from "../elements/fieldSelector";
import { GroupQuery, ResolveGroupOutput } from "../stages/group";
import { ProjectQuery, ResolveProjectOutput } from "../stages/project";
import {
  ReplaceRootQuery,
  ResolveReplaceRootOutput,
} from "../stages/replaceRoot";
import { ResolveUnionWithOutput } from "../stages/unionWith";
import { SortQuery } from "../stages/sort";
import { ResolveUnwindOutput } from "../stages/unwind";
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

/**
 * Pipeline scope:
 * - "full": Top-level pipeline — all stages allowed (default)
 * - "sub": Sub-pipeline inside $lookup/$unionWith/$facet — $out, $facet, execute() disallowed
 */
export type PipelineScope = "full" | "sub";

type AllowedSource<Mode extends LookupMode, T extends Document> =
  Mode extends "model" ? Source<T> : Collection<T>;

/**
 * Helper to create pipeline functions with proper typing.
 * Sub-pipelines always use "sub" scope to enforce MongoDB restrictions.
 */
export type PipelineBuilder<
  D extends Document,
  O extends Document,
  Mode extends LookupMode = "runtime",
> = (p: Pipeline<D, D, Mode, "sub">) => Pipeline<D, O, Mode, "sub">;

export class Pipeline<
  StartingDocs extends Document = never,
  PreviousStageDocs extends Document = StartingDocs,
  Mode extends LookupMode = "runtime",
  Scope extends PipelineScope = "full",
> {
  /** @internal Phantom brand for sub-pipeline restriction enforcement */
  declare readonly _scope: Scope;

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
  }

  /** Create a chained pipeline that carries forward ancestor sources */
  private _chain<NewOutput extends Document>(
    newStages: Document[],
    additionalAncestors: Source<any>[] = []
  ): Pipeline<StartingDocs, NewOutput, Mode, Scope> {
    const next = new Pipeline<StartingDocs, NewOutput, Mode, Scope>({
      pipeline: [...this.pipeline, ...newStages],
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
    ResolveMatchOutput<M, PreviousStageDocs>,
    Mode,
    Scope
  > {
    return this._chain<ResolveMatchOutput<M, PreviousStageDocs>>([{ $match }]);
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): Pipeline<
    StartingDocs,
    ResolveSetOutput<S, PreviousStageDocs>,
    Mode,
    Scope
  > {
    return this._chain<ResolveSetOutput<S, PreviousStageDocs>>([{ $set }]);
  }

  unset<const U extends UnsetQuery<PreviousStageDocs>>(
    $unset: U
  ): Pipeline<
    StartingDocs,
    ResolveUnsetOutput<U, PreviousStageDocs>,
    Mode,
    Scope
  > {
    return this._chain<ResolveUnsetOutput<U, PreviousStageDocs>>([{ $unset }]);
  }

  lookup<
    C extends AllowedSource<Mode, any>,
    LocalField extends FieldPath<PreviousStageDocs>,
    LocalFieldType extends GetFieldType<PreviousStageDocs, LocalField>,
    ForeignField extends
      | FieldPathsThatInferToForLookup<
          InferSourceType<C>,
          LocalFieldType extends string ? string : LocalFieldType
        >
      | FieldPathsThatInferToForLookup<InferSourceType<C>, LocalFieldType>,
    NewKey extends string,
    PipelineOutput extends Document = InferSourceType<C>,
  >(
    $lookup:
      | {
          from: C;
          localField: LocalField;
          foreignField: ForeignField;
          as: NewKey;
          pipeline?: PipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
      | {
          from: C;
          as: NewKey;
          pipeline: PipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
  ): Pipeline<
    StartingDocs,
    ResolveLookupOutput<PreviousStageDocs, NewKey, PipelineOutput>,
    Mode,
    Scope
  > {
    const { from, pipeline, ...$lookupRest } = $lookup;

    // Get collection name from source
    const collectionName = (from as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(
          new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode, "sub">({
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
      ResolveLookupOutput<PreviousStageDocs, NewKey, PipelineOutput>
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
  >($graphLookup: {
    from: C;
    startWith: StartWith;
    connectFromField: ConnectFromField;
    connectToField: ConnectToField;
    as: NewKey;
    maxDepth?: number;
    depthField?: DepthField;
    restrictSearchWithMatch?: MatchQuery<InferSourceType<C>>;
  }): Pipeline<
    StartingDocs,
    ResolveGraphLookupOutput<
      PreviousStageDocs,
      NewKey,
      InferSourceType<C>,
      DepthField
    >,
    Mode,
    Scope
  > {
    const { from, ...rest } = $graphLookup;

    const collectionName = (from as Source<any>).getOutputCollectionName();

    return this._chain<
      ResolveGraphLookupOutput<
        PreviousStageDocs,
        NewKey,
        InferSourceType<C>,
        DepthField
      >
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

  group<const G extends GroupQuery<PreviousStageDocs>>(
    $group: G
  ): Pipeline<
    StartingDocs,
    ResolveGroupOutput<PreviousStageDocs, G>,
    Mode,
    Scope
  > {
    return this._chain<ResolveGroupOutput<PreviousStageDocs, G>>([{ $group }]);
  }

  project<const P extends ProjectQuery<PreviousStageDocs>>(
    $project: P
  ): Pipeline<
    StartingDocs,
    ResolveProjectOutput<P, PreviousStageDocs>,
    Mode,
    Scope
  > {
    return this._chain<ResolveProjectOutput<P, PreviousStageDocs>>([
      { $project },
    ]);
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): Pipeline<
    StartingDocs,
    ResolveReplaceRootOutput<R, PreviousStageDocs>,
    Mode,
    Scope
  > {
    return this._chain<ResolveReplaceRootOutput<R, PreviousStageDocs>>([
      { $replaceRoot },
    ]);
  }

  /**
   * Sort documents by field values (ascending 1 or descending -1)
   * @example .sort({ createdAt: -1, name: 1 })
   */
  sort<const S extends SortQuery<PreviousStageDocs>>(
    $sort: S
  ): Pipeline<StartingDocs, PreviousStageDocs, Mode, Scope> {
    return this._chain<PreviousStageDocs>([{ $sort }]);
  }

  /**
   * Limit the number of documents in the pipeline
   * @example .limit(10)
   */
  limit(count: number): Pipeline<StartingDocs, PreviousStageDocs, Mode, Scope> {
    return this._chain<PreviousStageDocs>([{ $limit: count }]);
  }

  /**
   * Skip a number of documents
   * @example .skip(20).limit(10)
   */
  skip(count: number): Pipeline<StartingDocs, PreviousStageDocs, Mode, Scope> {
    return this._chain<PreviousStageDocs>([{ $skip: count }]);
  }

  /**
   * Deconstruct an array field into multiple documents (T[] → T)
   * @example .unwind("$items") or .unwind({ path: "$items", includeArrayIndex: "idx" })
   */
  unwind<
    Path extends FieldReferencesThatInferTo<PreviousStageDocs, unknown[]>,
    IndexField extends string = never,
  >(
    $unwind:
      | Path
      | {
          path: Path;
          includeArrayIndex?: IndexField;
          preserveNullAndEmptyArrays?: boolean;
        }
  ): Pipeline<
    StartingDocs,
    ResolveUnwindOutput<PreviousStageDocs, WithoutDollar<Path>, IndexField>,
    Mode,
    Scope
  > {
    return this._chain<
      ResolveUnwindOutput<PreviousStageDocs, WithoutDollar<Path>, IndexField>
    >([{ $unwind }]);
  }

  unionWith<
    C extends AllowedSource<Mode, any>,
    PipelineOutput extends Document = InferSourceType<C>,
  >(
    $unionWith:
      | {
          coll: C;
          pipeline?: PipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
      | {
          coll: C;
          pipeline: PipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
  ): Pipeline<
    StartingDocs,
    ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>,
    Mode,
    Scope
  > {
    const { coll, pipeline } = $unionWith;

    // Get collection name from source
    const collectionName = (coll as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(
          new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode, "sub">()
        )
      : undefined;

    // Include the unionWith source + any ancestors from the sub-pipeline
    const ancestors: Source<any>[] = [coll as Source<any>];
    if (resolvedPipeline) {
      ancestors.push(...resolvedPipeline.getAncestorsFromStages());
    }

    return this._chain<
      ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>
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
    this: Pipeline<StartingDocs, PreviousStageDocs, Mode, "full">,
    $facet: F
  ): Pipeline<
    StartingDocs,
    ResolveFacetOutput<PreviousStageDocs, F>,
    Mode,
    "full"
  > {
    const facetStage: Record<string, Document[]> = {};
    const ancestors: Source<any>[] = [];

    for (const [key, builder] of Object.entries($facet)) {
      const subPipeline = (builder as PipelineBuilder<any, any, any>)(
        new Pipeline<PreviousStageDocs, PreviousStageDocs, Mode, "sub">()
      );
      facetStage[key] = subPipeline.getPipeline();
      ancestors.push(...subPipeline.getAncestorsFromStages());
    }

    return this._chain<ResolveFacetOutput<PreviousStageDocs, F>>(
      [{ $facet: facetStage }],
      ancestors
    ) as Pipeline<
      StartingDocs,
      ResolveFacetOutput<PreviousStageDocs, F>,
      Mode,
      "full"
    >;
  }

  out(this: Pipeline<any, any, any, "full">, $out: string) {
    return this._chain<never>([{ $out }]);
  }

  execute(
    this: Pipeline<any, any, any, "full">,
    args: {
      client?: MongoClient;
      databaseName?: string;
      collectionName?: string;
    } = {}
  ): AggregationCursor<PreviousStageDocs> {
    const client = args.client ?? this.client ?? pipesafe.client;
    if (!client) throw new Error("Not connected");

    const db = args.databaseName ?? this.databaseName;

    const collection = args.collectionName ?? this.collectionName;
    if (!collection) throw new Error("No collection name provided");

    return client.db(db).collection(collection).aggregate(this.getPipeline());
  }
}

export type InferOutputType<P extends Pipeline<any, any>> =
  P extends Pipeline<any, infer Output> ? Output : never;
