import {
  Document,
  PassThrough,
  PipeSafeError,
  Prettify,
  WithoutDollar,
} from "../utils/core";
import { FieldReferencesThatInferTo } from "../elements/fieldReference";

/**
 * Acceptable values for `$unwind`'s path field. The user must supply a
 * field reference (`'$arrayField'`) to an array-typed field. The branded
 * `PipeSafeError` arm surfaces in IDE hovers when a non-array field is
 * referenced (`'$scalar'`) — without the brand the union would degrade to
 * `never` and the user would see a cryptic "is not assignable to never".
 */
export type UnwindPath<Schema extends Document> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | PipeSafeError<`Stage '$unwind' requires an array field reference.`>;

/**
 * `$unwind`'s full input shape: a bare path or an options object. `P` is the
 * literal path inferred at the call site (constrained to `UnwindPath`, so the
 * brand arm surfaces in hovers when a non-array field is referenced);
 * `Pipeline.unwind` threads it into `ResolveUnwindOutput`.
 */
export type UnwindQuery<
  Schema extends Document,
  P extends UnwindPath<Schema> = UnwindPath<Schema>,
  IndexField extends string = never,
> =
  | P
  | {
      path: P;
      includeArrayIndex?: IndexField;
      preserveNullAndEmptyArrays?: boolean;
    };

/**
 * Transform an array type to its element type
 * T[] becomes T, nested arrays flatten one level
 */
type UnwoundField<T> = T extends (infer E)[] ? E : T;

/**
 * Resolve the output type of an $unwind stage
 *
 * - The unwound array field becomes its element type (T[] -> T)
 * - If includeArrayIndex is specified, adds that field with type number
 * - All other fields remain unchanged
 *
 * @example
 * type Input = { _id: string; items: { name: string; qty: number }[] };
 * type Output = ResolveUnwindOutput<Input, "items", never>;
 * // { _id: string; items: { name: string; qty: number } }
 *
 * @example
 * type Output = ResolveUnwindOutput<Input, "items", "idx">;
 * // { _id: string; items: { name: string; qty: number }; idx: number }
 */
export type ResolveUnwindOutput<
  Schema extends Document,
  Path extends string,
  IndexField extends string = never,
> = PassThrough<
  Schema,
  Schema extends unknown ?
    Prettify<
      {
        [K in keyof Schema]: K extends Path ? UnwoundField<Schema[K]>
        : Schema[K];
      } & ([IndexField] extends [never] ? {} : { [K in IndexField]: number })
    >
  : never
>;

/**
 * Helper to extract path from unwind query (string or options object)
 */
export type ExtractUnwindPath<Query> =
  Query extends string ? WithoutDollar<Query>
  : Query extends { path: infer P extends string } ? WithoutDollar<P>
  : never;

/**
 * Helper to extract index field from unwind options
 */
export type ExtractIndexField<Query> =
  Query extends (
    {
      includeArrayIndex: infer I extends string;
    }
  ) ?
    I
  : never;
