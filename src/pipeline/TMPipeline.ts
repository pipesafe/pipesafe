import { tmql } from "../singleton/tmql";
import { Document } from "../utils/core";
import { MatchQuery, ResolveMatchOutput } from "../stages/match";
import { ResolveSetOutput, SetQuery } from "../stages/set";
import { ResolveUnsetOutput, UnsetQuery } from "../stages/unset";
import {
  FieldPath,
  FieldPathsThatInferToForLookup,
} from "../elements/fieldReference";
import { TMCollection } from "../collection/TMCollection";
import { ResolveLookupOutput } from "../stages/lookup";
import { GetFieldType } from "../elements/fieldSelector";
import { GroupQuery, ResolveGroupOutput } from "../stages/group";
import { ProjectQuery, ResolveProjectOutput } from "../stages/project";
import {
  ReplaceRootQuery,
  ResolveReplaceRootOutput,
} from "../stages/replaceRoot";
import { ResolveUnionWithOutput } from "../stages/unionWith";
import { AggregationCursor, MongoClient } from "mongodb";
import { type TMSource, type InferSourceType } from "../source/TMSource";

// ============================================================================
// Lookup Mode - Controls what sources can be used in lookup/unionWith
// ============================================================================

/**
 * Pipeline lookup mode:
 * - "runtime": Only TMCollection allowed in lookup/unionWith (default, for app code)
 * - "model": TMCollection OR TMModel allowed (for DAG/DW pipelines inside TMModel)
 */
export type LookupMode = "runtime" | "model";

type AllowedSource<Mode extends LookupMode, T extends Document> =
  Mode extends "model" ? TMSource<T> : TMCollection<T>;

/**
 * Helper to create pipeline functions with proper typing.
 */
type TMPipelineBuilder<
  D extends Document,
  O extends Document,
  Mode extends LookupMode = "runtime",
> = (p: TMPipeline<D, D, Mode>) => TMPipeline<D, O, Mode>;

export class TMPipeline<
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
  private readonly _ancestorsFromStages: TMSource<any>[] = [];

  /** Get all ancestor sources referenced in lookup/unionWith stages */
  getAncestorsFromStages(): TMSource<any>[] {
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
  private _chain<S extends Document, P extends Document>(
    newStages: Document[],
    additionalAncestors: TMSource<any>[] = []
  ): TMPipeline<S, P, Mode> {
    const next = new TMPipeline<S, P, Mode>({
      pipeline: [...this.pipeline, ...newStages],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
    // Carry forward existing ancestors + any new ones
    next._ancestorsFromStages.push(
      ...this._ancestorsFromStages,
      ...additionalAncestors
    );
    return next;
  }

  // Ability to use any aggregation stage(s) and manually type the output
  custom<CustomOutput extends Document>(pipelineStages: Document[]) {
    return this._chain<CustomOutput, CustomOutput>(pipelineStages);
  }

  // $match step
  match<const M extends MatchQuery<StartingDocs>>(
    $match: M
  ): TMPipeline<
    ResolveMatchOutput<M, StartingDocs>,
    ResolveMatchOutput<M, StartingDocs>,
    Mode
  > {
    return this._chain<
      ResolveMatchOutput<M, StartingDocs>,
      ResolveMatchOutput<M, StartingDocs>
    >([{ $match }]);
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): TMPipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>, Mode> {
    return this._chain<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>>([
      { $set },
    ]);
  }

  unset<const U extends UnsetQuery<StartingDocs>>(
    $unset: U
  ): TMPipeline<
    ResolveUnsetOutput<U, StartingDocs>,
    ResolveUnsetOutput<U, StartingDocs>,
    Mode
  > {
    return this._chain<
      ResolveUnsetOutput<U, StartingDocs>,
      ResolveUnsetOutput<U, StartingDocs>
    >([{ $unset }]);
  }

  // Lookup with function-only pipeline for automatic type inference
  // In "runtime" mode: only TMCollection allowed
  // In "model" mode: TMCollection OR TMModel allowed
  lookup<
    C extends AllowedSource<Mode, any>,
    LocalField extends FieldPath<StartingDocs>,
    LocalFieldType extends GetFieldType<StartingDocs, LocalField>,
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
          pipeline?: TMPipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode
          >;
        }
      | {
          from: C;
          as: NewKey;
          pipeline: TMPipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
  ): TMPipeline<
    StartingDocs,
    ResolveLookupOutput<StartingDocs, NewKey, PipelineOutput>,
    Mode
  > {
    const { from, pipeline, ...$lookupRest } = $lookup;

    // Get collection name from source
    const collectionName = (from as TMSource<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(
          new TMPipeline<InferSourceType<C>, InferSourceType<C>, Mode>({
            collectionName,
          })
        )
      : undefined;

    // Include the lookup source + any ancestors from the sub-pipeline
    const ancestors: TMSource<any>[] = [from as TMSource<any>];
    if (resolvedPipeline) {
      ancestors.push(...resolvedPipeline.getAncestorsFromStages());
    }

    return this._chain<
      StartingDocs,
      ResolveLookupOutput<StartingDocs, NewKey, PipelineOutput>
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

  group<const G extends GroupQuery<StartingDocs>>(
    $group: G
  ): TMPipeline<StartingDocs, ResolveGroupOutput<StartingDocs, G>, Mode> {
    return this._chain<StartingDocs, ResolveGroupOutput<StartingDocs, G>>([
      { $group },
    ]);
  }

  project<const P extends ProjectQuery<PreviousStageDocs>>(
    $project: P
  ): TMPipeline<
    StartingDocs,
    ResolveProjectOutput<P, PreviousStageDocs>,
    Mode
  > {
    return this._chain<
      StartingDocs,
      ResolveProjectOutput<P, PreviousStageDocs>
    >([{ $project }]);
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): TMPipeline<
    StartingDocs,
    ResolveReplaceRootOutput<R, PreviousStageDocs>,
    Mode
  > {
    return this._chain<
      StartingDocs,
      ResolveReplaceRootOutput<R, PreviousStageDocs>
    >([{ $replaceRoot }]);
  }

  // UnionWith
  // In "runtime" mode: only TMCollection allowed
  // In "model" mode: TMCollection OR TMModel allowed
  unionWith<
    C extends AllowedSource<Mode, any>,
    PipelineOutput extends Document = InferSourceType<C>,
  >(
    $unionWith:
      | {
          coll: C;
          pipeline?: TMPipelineBuilder<
            InferSourceType<C>,
            PipelineOutput,
            Mode
          >;
        }
      | {
          coll: C;
          pipeline: TMPipelineBuilder<InferSourceType<C>, PipelineOutput, Mode>;
        }
  ): TMPipeline<
    StartingDocs,
    ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>,
    Mode
  > {
    const { coll, pipeline } = $unionWith;

    // Get collection name from source
    const collectionName = (coll as TMSource<any>).getOutputCollectionName();

    const resolvedPipeline =
      pipeline ?
        pipeline(new TMPipeline<InferSourceType<C>, InferSourceType<C>, Mode>())
      : undefined;

    // Include the unionWith source + any ancestors from the sub-pipeline
    const ancestors: TMSource<any>[] = [coll as TMSource<any>];
    if (resolvedPipeline) {
      ancestors.push(...resolvedPipeline.getAncestorsFromStages());
    }

    return this._chain<
      StartingDocs,
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
    return this._chain<StartingDocs, never>([{ $out }]);
  }

  execute(
    args: {
      client?: MongoClient;
      databaseName?: string;
      collectionName?: string;
    } = {}
  ): AggregationCursor<StartingDocs> {
    const client = args.client ?? this.client ?? tmql.client;
    if (!client) throw new Error("Not connected");

    const db = args.databaseName ?? this.databaseName;

    const collection = args.collectionName ?? this.collectionName;
    if (!collection) throw new Error("No collection name provided");

    return client.db(db).collection(collection).aggregate(this.getPipeline());
  }
}

export type InferOutputType<Pipeline extends TMPipeline<any, any>> =
  Pipeline extends TMPipeline<any, infer Output> ? Output : never;
