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

  /** Tracks sources used in lookup/unionWith stages */
  private _lookupSources: TMSource<any>[] = [];

  /** Get all sources referenced in lookup/unionWith stages */
  getLookupSources(): TMSource<any>[] {
    return this._lookupSources;
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
      lookupSources?: TMSource<any>[] | undefined;
    } = {}
  ) {
    this.pipeline = args.pipeline ?? [];
    this.client = args.client;
    this.collectionName = args.collectionName;
    this.databaseName = args.databaseName;
    this._lookupSources = args.lookupSources ?? [];
  }

  // Ability to use any aggregation stage(s) and manually type the output
  custom<CustomOutput extends Document>(pipelineStages: Document[]) {
    return new TMPipeline<CustomOutput, CustomOutput, Mode>({
      pipeline: [...this.pipeline, ...pipelineStages],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
  }

  // $match step
  match<const M extends MatchQuery<StartingDocs>>(
    $match: M
  ): TMPipeline<
    ResolveMatchOutput<M, StartingDocs>,
    ResolveMatchOutput<M, StartingDocs>,
    Mode
  > {
    return new TMPipeline<
      ResolveMatchOutput<M, StartingDocs>,
      ResolveMatchOutput<M, StartingDocs>,
      Mode
    >({
      pipeline: [...this.pipeline, { $match }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): TMPipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>, Mode> {
    return new TMPipeline<
      StartingDocs,
      ResolveSetOutput<S, PreviousStageDocs>,
      Mode
    >({
      pipeline: [...this.pipeline, { $set }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
  }

  unset<const U extends UnsetQuery<StartingDocs>>(
    $unset: U
  ): TMPipeline<
    ResolveUnsetOutput<U, StartingDocs>,
    ResolveUnsetOutput<U, StartingDocs>,
    Mode
  > {
    return new TMPipeline<
      ResolveUnsetOutput<U, StartingDocs>,
      ResolveUnsetOutput<U, StartingDocs>,
      Mode
    >({
      pipeline: [...this.pipeline, { $unset }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
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

    return new TMPipeline<
      StartingDocs,
      ResolveLookupOutput<StartingDocs, NewKey, PipelineOutput>,
      Mode
    >({
      pipeline: [
        ...this.pipeline,
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
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      // Track the lookup source
      lookupSources: [...this._lookupSources, from as TMSource<any>],
    });
  }

  group<const G extends GroupQuery<StartingDocs>>(
    $group: G
  ): TMPipeline<StartingDocs, ResolveGroupOutput<StartingDocs, G>, Mode> {
    return new TMPipeline<
      StartingDocs,
      ResolveGroupOutput<StartingDocs, G>,
      Mode
    >({
      pipeline: [...this.pipeline, { $group }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
  }

  project<const P extends ProjectQuery<PreviousStageDocs>>(
    $project: P
  ): TMPipeline<
    StartingDocs,
    ResolveProjectOutput<P, PreviousStageDocs>,
    Mode
  > {
    return new TMPipeline<
      StartingDocs,
      ResolveProjectOutput<P, PreviousStageDocs>,
      Mode
    >({
      pipeline: [...this.pipeline, { $project }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): TMPipeline<
    StartingDocs,
    ResolveReplaceRootOutput<R, PreviousStageDocs>,
    Mode
  > {
    return new TMPipeline<
      StartingDocs,
      ResolveReplaceRootOutput<R, PreviousStageDocs>,
      Mode
    >({
      pipeline: [...this.pipeline, { $replaceRoot }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
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

    return new TMPipeline<
      StartingDocs,
      ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>,
      Mode
    >({
      pipeline: [
        ...this.pipeline,
        {
          $unionWith: {
            coll: collectionName,
            ...(resolvedPipeline && {
              pipeline: resolvedPipeline.getPipeline(),
            }),
          },
        },
      ],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      // Track the unionWith source
      lookupSources: [...this._lookupSources, coll as TMSource<any>],
    });
  }

  out($out: string) {
    return new TMPipeline<StartingDocs, never>({
      pipeline: [...this.pipeline, { $out }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
      lookupSources: this._lookupSources,
    });
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
