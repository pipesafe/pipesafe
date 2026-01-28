import { InferNestedFieldReference } from "../elements/fieldReference";
import { Expression, InferExpression } from "../elements/expressions";
import { AnyLiteral } from "../elements/literals";
import {
  Document,
  FlattenDotSet,
  ApplySetUpdates,
  Prettify,
  HasDottedKeys,
} from "../utils/core";

export type RemoveNever<T> = Prettify<{
  [K in keyof T as [T[K]] extends [never] ? never : K]: T[K];
}>;

/**
 * Transformation expressions - aggregation operators that transform values
 * These are not literals, but expressions that compute new values
 * Uses Expression which includes array expressions and date expressions
 */
export type TransformationExpression<Schema extends Document> =
  Expression<Schema>;
// Future: Add more transformation operators here (e.g., string ops, math ops, etc.)

export type SetQuery<Schema extends Document> = {
  [k: string]:
    | AnyLiteral<Schema>
    | TransformationExpression<Schema>
    | "$$REMOVE";
};

export type ResolveSetQueryValueType<
  Schema extends Document,
  Query extends SetQuery<Schema>,
  Key extends keyof Query,
> =
  Query[Key] extends "$$REMOVE" ? never
  : Query[Key] extends Expression<Schema> ?
    InferExpression<Schema, Query[Key]> // Handle expression operators
  : InferNestedFieldReference<Schema, Query[Key]>; // Fall back to literal/field ref handling

// Don't use RemoveNever here - let ApplySetUpdates handle never values
export type ResolveSetInlineSchema<
  Schema extends Document,
  Query extends SetQuery<Schema>,
> = {
  [Key in keyof Query]: ResolveSetQueryValueType<Schema, Query, Key>;
};

export type ResolveSetOutput<Query, Schema extends Document> =
  Query extends SetQuery<Schema> ?
    HasDottedKeys<ResolveSetInlineSchema<Schema, Query>> extends true ?
      // Has dotted keys - use FlattenDotSet (will optimize in Phase 2)
      ApplySetUpdates<
        Schema,
        FlattenDotSet<ResolveSetInlineSchema<Schema, Query>>
      >
    : // No dotted keys - skip FlattenDotSet entirely (Early Exit optimization)
      ApplySetUpdates<Schema, ResolveSetInlineSchema<Schema, Query>>
  : never;
