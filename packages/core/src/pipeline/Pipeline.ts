import { pipesafe } from "../singleton/pipesafe";
import { Document, WithoutDollar } from "../utils/core";
import { MatchQuery, ResolveMatchOutput } from "../stages/match";
import { ResolveSetOutput, SetQuery } from "../stages/set";
import { ResolveUnsetOutput, UnsetQuery } from "../stages/unset";
import {
  FieldPath,
  FieldPathsThatInferToForLookup,
  FieldReferencesThatInferTo,
} from "../elements/fieldReference";
import { Collection } from "../collection/Collection";
import { ResolveLookupOutput } from "../stages/lookup";
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

type AllowedSource<Mode extends LookupMode, T extends Document> =
  Mode extends "model" ? Source<T> : Collection<T>;

/**
 * Helper to create pipeline functions with proper typing.
 */
type PipelineBuilder<
  D extends Document,
  O extends Document,
  Mode extends LookupMode = "runtime",
> = (p: Pipeline<D, D, Mode>) => Pipeline<D, O, Mode>;

export class Pipeline<
  StartingDocs extends Document = never,
  PreviousStageDocs extends Document = StartingDocs,
  Mode extends LookupMode = "runtime",
> {
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
  ): Pipeline<StartingDocs, NewOutput, Mode> {
    const next = new Pipeline<StartingDocs, NewOutput, Mode>({
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
  ): Pipeline<StartingDocs, ResolveMatchOutput<M, PreviousStageDocs>, Mode> {
    return this._chain<ResolveMatchOutput<M, PreviousStageDocs>>([{ $match }]);
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): Pipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>, Mode> {
    return this._chain<ResolveSetOutput<S, PreviousStageDocs>>([{ $set }]);
  }

  unset<const U extends UnsetQuery<PreviousStageDocs>>(
    $unset: U
  ): Pipeline<StartingDocs, ResolveUnsetOutput<U, PreviousStageDocs>, Mode> {
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
    Mode
  > {
    const { from, pipeline, ...$lookupRest } = $lookup;

    // Get collection name from source
    const collectionName = (from as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(
          new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode>({
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

  group<const G extends GroupQuery<PreviousStageDocs>>(
    $group: G
  ): Pipeline<StartingDocs, ResolveGroupOutput<PreviousStageDocs, G>, Mode> {
    return this._chain<ResolveGroupOutput<PreviousStageDocs, G>>([{ $group }]);
  }

  project<const P extends ProjectQuery<PreviousStageDocs>>(
    $project: P
  ): Pipeline<StartingDocs, ResolveProjectOutput<P, PreviousStageDocs>, Mode> {
    return this._chain<ResolveProjectOutput<P, PreviousStageDocs>>([
      { $project },
    ]);
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): Pipeline<
    StartingDocs,
    ResolveReplaceRootOutput<R, PreviousStageDocs>,
    Mode
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
  ): Pipeline<StartingDocs, PreviousStageDocs, Mode> {
    return this._chain<PreviousStageDocs>([{ $sort }]);
  }

  /**
   * Limit the number of documents in the pipeline
   * @example .limit(10)
   */
  limit(count: number): Pipeline<StartingDocs, PreviousStageDocs, Mode> {
    return this._chain<PreviousStageDocs>([{ $limit: count }]);
  }

  /**
   * Skip a number of documents
   * @example .skip(20).limit(10)
   */
  skip(count: number): Pipeline<StartingDocs, PreviousStageDocs, Mode> {
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
    Mode
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
    Mode
  > {
    const { coll, pipeline } = $unionWith;

    // Get collection name from source
    const collectionName = (coll as Source<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(new Pipeline<InferSourceType<C>, InferSourceType<C>, Mode>())
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

  out($out: string) {
    return this._chain<never>([{ $out }]);
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

    const db = args.databaseName ?? this.databaseName;

    const collection = args.collectionName ?? this.collectionName;
    if (!collection) throw new Error("No collection name provided");

    return client.db(db).collection(collection).aggregate(this.getPipeline());
  }
}

export type InferOutputType<P extends Pipeline<any, any>> =
  P extends Pipeline<any, infer Output> ? Output : never;
