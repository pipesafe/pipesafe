import { Document, PassThrough, Prettify } from "../utils/core";

// Todo: Convert new key to a nested field and merge
export type ResolveLookupOutput<
  StartingDocs extends Document,
  NewKey extends string,
  PipelineOutput extends Document,
> = PassThrough<
  StartingDocs,
  StartingDocs extends any ?
    Prettify<Omit<StartingDocs, NewKey> & { [K in NewKey]: PipelineOutput[] }>
  : never
>;
