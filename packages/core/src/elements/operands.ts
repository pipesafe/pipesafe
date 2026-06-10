/**
 * Operand kernel (docs/type-standardisation-plan.md §3.2).
 *
 * Two primitives back every brand-carrying operand helper in the library.
 * They encode the two distinct patterns identified in the spec:
 *
 * 1. `FieldOperand` — *field-position* check (e.g. `$gte` under a field
 *    selector in `$match`): given the field's already-resolved type `T`,
 *    return the allowed operand type or a branded error. Non-distributive by
 *    construction (`[T] extends [Allowed]`), so a mixed-typed union field is
 *    rejected with one error rather than a per-branch union of brands.
 *
 * 2. `ExpressionOperand` — *expression-position* set (e.g. `$add`'s
 *    elements, `$sum`'s operand): given the schema, enumerate the acceptable
 *    literals/field references for a target type, with the brand arm so the
 *    hover names the constraint instead of degrading to `never`.
 *
 * Message text stays at each helper's call site, built via `RequiresMsg`
 * (utils/errors.ts) so the CLAUDE.md message skeleton is enforced
 * structurally. Helpers whose success type depends on an inferred element
 * type (e.g. `$all`'s `U[]`) keep a specialized conditional but still build
 * their message through `RequiresMsg`.
 */

import { PipeSafeError } from "../utils/errors";
import { Document } from "../utils/objects";
import { FieldReferencesThatInferTo } from "./fieldReference";

/**
 * Field-position check: the field's resolved type `T` must satisfy `Allowed`;
 * on success the operand type is `Result` (defaults to `T` — pass e.g.
 * `number` for `$size` where the operand is an index regardless of `T`).
 */
export type FieldOperand<T, Allowed, Msg extends string, Result = T> =
  [T] extends [Allowed] ? Result : PipeSafeError<Msg>;

/**
 * Expression-position set: acceptable literals/refs for a target type, with
 * the brand arm for hover messaging.
 */
export type ExpressionOperand<Schema extends Document, T, Msg extends string> =
  | T
  | FieldReferencesThatInferTo<Schema, T>
  | PipeSafeError<Msg>;
