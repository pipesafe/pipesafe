import { tmql } from "../singleton/tmql";
import { Document } from "../utils/core";
import { MatchQuery, ResolveMatchOutput } from "../stages/match";
import { ResolveSetOutput, SetQuery } from "../stages/set";
import { ResolveUnsetOutput, UnsetQuery } from "../stages/unset";
import {
  FieldPath,
  FieldPathsThatInferToForLookup,
} from "../elements/fieldReference";
import { InferCollectionType, TMCollection } from "../collection/TMCollection";
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

type PLFrom<D extends Document, O extends Document> = (
  p: TMPipeline<D, D>
) => TMPipeline<D, O>;
export class TMPipeline<
  StartingDocs extends Document = never,
  PreviousStageDocs extends Document = StartingDocs,
> {
  private pipeline: Document[] = [];
  getPipeline(): PreviousStageDocs extends never ? never : Document[] {
    return this.pipeline as PreviousStageDocs extends never ? never
    : Document[];
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

  // Ability to use any aggregation stage(s) and manually type the output
  custom<CustomOutput extends Document>(pipelineStages: Document[]) {
    return new TMPipeline<CustomOutput>({
      pipeline: [...this.pipeline, ...pipelineStages],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  // $match step
  match<const M extends MatchQuery<StartingDocs>>(
    $match: M
  ): TMPipeline<ResolveMatchOutput<M, StartingDocs>> {
    return new TMPipeline<ResolveMatchOutput<M, StartingDocs>>({
      pipeline: [...this.pipeline, { $match }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S
  ): TMPipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>> {
    return new TMPipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>>(
      {
        pipeline: [...this.pipeline, { $set }],
        collectionName: this.collectionName,
        databaseName: this.databaseName,
      }
    );
  }

  unset<const U extends UnsetQuery<StartingDocs>>(
    $unset: U
  ): TMPipeline<ResolveUnsetOutput<U, StartingDocs>> {
    return new TMPipeline<ResolveUnsetOutput<U, StartingDocs>>({
      pipeline: [...this.pipeline, { $unset }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  // Lookup with function-only pipeline for automatic type inference
  lookup<
    C extends TMCollection<any>,
    LocalField extends FieldPath<StartingDocs>,
    LocalFieldType extends GetFieldType<StartingDocs, LocalField>,
    ForeignField extends
      | FieldPathsThatInferToForLookup<
          InferCollectionType<C>,
          LocalFieldType extends string ? string : LocalFieldType
        >
      | FieldPathsThatInferToForLookup<InferCollectionType<C>, LocalFieldType>,
    NewKey extends string,
    PipelineOutput extends Document = InferCollectionType<C>,
  >(
    $lookup:
      | {
          from: C;
          localField: LocalField;
          foreignField: ForeignField;
          as: NewKey;
          pipeline?: PLFrom<InferCollectionType<C>, PipelineOutput>;
        }
      | {
          from: C;
          as: NewKey;
          pipeline: PLFrom<InferCollectionType<C>, PipelineOutput>;
        }
  ): TMPipeline<
    StartingDocs,
    ResolveLookupOutput<StartingDocs, NewKey, PipelineOutput>
  > {
    const { from, pipeline, ...$lookupRest } = $lookup;

    // Call the pipeline function with a properly typed pipeline
    const resolvedPipeline =
      pipeline ?
        pipeline(
          new TMPipeline<InferCollectionType<C>, InferCollectionType<C>>({
            collectionName: from.getCollectionName(),
            // Come back to this
          })
        )
      : undefined;

    return new TMPipeline<
      StartingDocs,
      ResolveLookupOutput<StartingDocs, NewKey, PipelineOutput>
    >({
      pipeline: [
        ...this.pipeline,
        {
          $lookup: {
            from: from.getCollectionName(),
            ...$lookupRest,
            ...(resolvedPipeline && {
              pipeline: resolvedPipeline.getPipeline(),
            }),
          },
        },
      ],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  group<const G extends GroupQuery<StartingDocs>>(
    $group: G
  ): TMPipeline<StartingDocs, ResolveGroupOutput<StartingDocs, G>> {
    return new TMPipeline<StartingDocs, ResolveGroupOutput<StartingDocs, G>>({
      pipeline: [...this.pipeline, { $group }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  project<const P extends ProjectQuery<PreviousStageDocs>>(
    $project: P
  ): TMPipeline<StartingDocs, ResolveProjectOutput<P, PreviousStageDocs>> {
    return new TMPipeline<
      StartingDocs,
      ResolveProjectOutput<P, PreviousStageDocs>
    >({
      pipeline: [...this.pipeline, { $project }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  replaceRoot<const R extends ReplaceRootQuery<PreviousStageDocs>>(
    $replaceRoot: R
  ): TMPipeline<StartingDocs, ResolveReplaceRootOutput<R, PreviousStageDocs>> {
    return new TMPipeline<
      StartingDocs,
      ResolveReplaceRootOutput<R, PreviousStageDocs>
    >({
      pipeline: [...this.pipeline, { $replaceRoot }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  unionWith<
    C extends TMCollection<any>,
    PipelineOutput extends Document = InferCollectionType<C>,
  >(
    $unionWith:
      | {
          coll: C;
          pipeline?: PLFrom<InferCollectionType<C>, PipelineOutput>;
        }
      | {
          coll: C;
          pipeline: PLFrom<InferCollectionType<C>, PipelineOutput>;
        }
  ): TMPipeline<
    StartingDocs,
    ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>
  > {
    const { coll, pipeline } = $unionWith;

    // Call the pipeline function with a properly typed pipeline
    const resolvedPipeline =
      pipeline ?
        pipeline(
          new TMPipeline<InferCollectionType<C>, InferCollectionType<C>>()
        )
      : undefined;

    return new TMPipeline<
      StartingDocs,
      ResolveUnionWithOutput<PreviousStageDocs, PipelineOutput>
    >({
      pipeline: [
        ...this.pipeline,
        {
          $unionWith: {
            coll: coll.getCollectionName(),
            ...(resolvedPipeline && {
              pipeline: resolvedPipeline.getPipeline(),
            }),
          },
        },
      ],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
    });
  }

  out($out: string) {
    return new TMPipeline<StartingDocs, never>({
      pipeline: [...this.pipeline, { $out }],
      collectionName: this.collectionName,
      databaseName: this.databaseName,
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
