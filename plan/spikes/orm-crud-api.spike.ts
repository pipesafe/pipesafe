/**
 * SPIKE: Typed CRUD, hooks, and transactions API (roadmap doc: plan/03-orm-roadmap.md, sections 2, 4, 5)
 *
 * Purpose:  Illustrate the proposed P0 typed-CRUD surface on Collection —
 *           MatchQuery-based find/update filters, projection-shaped result
 *           narrowing (the inference-based answer to Prisma's GetResult),
 *           branded update operators ($set/$inc/$push), orFail/sanitizeFilter
 *           affordances, typed query interceptors (hooks), and
 *           AsyncLocalStorage-propagated transactions.
 * Status:   ILLUSTRATIVE ONLY — this API is not built. Type sketches are
 *           simplified stand-ins for the real machinery in
 *           packages/core/src/stages/match.ts and project.ts; they need not
 *           compile against the repo.
 * Build:    This file lives under plan/spikes/ and is EXCLUDED from the build,
 *           lint, and test pipelines. It is dependency-free by design: all
 *           external and repo types are stubbed inline.
 */

/* ------------------------------------------------------------------ */
/* Inline stubs standing in for existing PipeSafe machinery            */
/* ------------------------------------------------------------------ */

declare class ObjectId {
  toHexString(): string;
}

type Document = Record<string, any>;

/** packages/core/src/utils/core.ts — the existing branded error. */
interface PipeSafeError<Msg extends string> {
  readonly "~pipesafe.error": Msg;
}

/**
 * Stand-in for packages/core/src/stages/match.ts `MatchQuery<Schema>`.
 * The real type is REUSED VERBATIM for find/count/delete/update filters:
 * full operator set, full-depth dotted FieldSelector paths (vs Mongoose v9's
 * one-level WithLevel1NestedPaths), operand brands (NumericOperand etc.).
 */
type MatchQuery<Schema extends Document> = Record<string, unknown>; // real: match.ts:105

/** Stand-in for match.ts ResolveMatchOutput — union narrowing via FilterUnion. */
type ResolveMatchOutput<Query, Schema extends Document> = Schema;

/** Stand-ins for fieldSelector.ts path machinery. */
type FieldSelector<Schema extends Document> = string;
type FieldSelectorsThatInferTo<Schema extends Document, T> = string;

/* ------------------------------------------------------------------ */
/* 1. Typed update operators (new, but formulaic)                      */
/* ------------------------------------------------------------------ */

/**
 * Each operator constrains its keys to field selectors of the right type and
 * brands violations at the OPERAND position (TS2322, per CLAUDE.md convention):
 *
 *   { $inc: { name: 1 } }
 *     -> Type '1' is not assignable to type
 *        "PipeSafeError<\"Operator '$inc' requires a field that infers to a number.\">"
 */
type UpdateQuery<Schema extends Document> = {
  /** Reuses set.ts dotted-key expansion + optionality semantics. */
  $set?: { [P in FieldSelector<Schema>]?: unknown }; // real: SetQuery machinery
  $unset?: { [P in FieldSelector<Schema>]?: "" | true };
  $inc?: { [P in FieldSelectorsThatInferTo<Schema, number>]?: number };
  $mul?: { [P in FieldSelectorsThatInferTo<Schema, number>]?: number };
  $min?: {
    [P in FieldSelectorsThatInferTo<Schema, number | Date>]?: number | Date;
  };
  $max?: {
    [P in FieldSelectorsThatInferTo<Schema, number | Date>]?: number | Date;
  };
  /** Element type checked against the array's element type; $each supported. */
  $push?: { [P in FieldSelectorsThatInferTo<Schema, unknown[]>]?: unknown };
  $addToSet?: { [P in FieldSelectorsThatInferTo<Schema, unknown[]>]?: unknown };
  $pull?: { [P in FieldSelectorsThatInferTo<Schema, unknown[]>]?: unknown };
  $currentDate?: { [P in FieldSelectorsThatInferTo<Schema, Date>]?: true };
};

/* ------------------------------------------------------------------ */
/* 2. Projection-shaped result narrowing (Prisma's GetResult lesson,   */
/*    inference-based — no generated Payload types)                    */
/* ------------------------------------------------------------------ */

/** Reuses project.ts ValidateProjectQuery (mixed-mode rejection, unknown-key brands). */
type ProjectionQuery<Schema extends Document> = {
  [P in FieldSelector<Schema>]?: 0 | 1;
};

/** Stand-in for project.ts output resolution: the literal projection reshapes the result. */
type ResolveProjection<Schema extends Document, P> =
  P extends undefined ? Schema : Partial<Schema>;

interface FindOptions<
  Schema extends Document,
  P extends ProjectionQuery<Schema> | undefined,
> {
  projection?: P;
  sort?: Record<FieldSelector<Schema>, 1 | -1>; // direct-typed like Pipeline.sort
  limit?: number;
  skip?: number;
  /**
   * Runtime defense (Mongoose's sanitizeFilter): wraps $-prefixed nested objects
   * in the filter with $eq so user-supplied values cannot smuggle operators.
   */
  sanitizeFilter?: boolean;
  session?: unknown; // explicit override; otherwise picked up from ALS (see §5)
}

/* ------------------------------------------------------------------ */
/* 3. The typed Collection surface (replaces raw Filter<Docs> typing)  */
/* ------------------------------------------------------------------ */

/** Thenable + orFail, so `await users.findOne(f)` and `.orFail()` both work. */
interface FindOneResult<T> extends PromiseLike<T | null> {
  /** Throws DocumentNotFoundError instead of resolving null (Mongoose's orFail). */
  orFail(): Promise<T>;
}

declare class TypedCollection<TDoc extends Document> {
  readonly __outputType: TDoc;

  /**
   * Pattern: `<const F extends MatchQuery<TDoc>>` — the generic-constraint
   * signature from CLAUDE.md. The literal F drives:
   *   1. operand validation (PipeSafeError brands fire at the offending value)
   *   2. UNION NARROWING: find({ status: "shipped" }) on a union schema
   *      returns only the matching variant (ResolveMatchOutput/FilterUnion)
   *   3. projection-shaped result narrowing via the literal P
   */
  find<
    const F extends MatchQuery<TDoc>,
    const P extends ProjectionQuery<TDoc> | undefined = undefined,
  >(
    filter?: F,
    options?: FindOptions<TDoc, P>
  ): Promise<Array<ResolveProjection<ResolveMatchOutput<F, TDoc>, P>>>;

  findOne<
    const F extends MatchQuery<TDoc>,
    const P extends ProjectionQuery<TDoc> | undefined = undefined,
  >(
    filter: F,
    options?: FindOptions<TDoc, P>
  ): FindOneResult<ResolveProjection<ResolveMatchOutput<F, TDoc>, P>>;

  /** Insert type derived from schema: _id and defaulted fields become optional. */
  insertOne(
    doc: TDoc /* real: OptionalDefaults<TDoc> */
  ): Promise<{ insertedId: ObjectId }>;

  updateOne<
    const F extends MatchQuery<TDoc>,
    const U extends UpdateQuery<TDoc>,
  >(
    filter: F,
    update: U
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  updateMany<
    const F extends MatchQuery<TDoc>,
    const U extends UpdateQuery<TDoc>,
  >(
    filter: F,
    update: U
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  deleteOne<const F extends MatchQuery<TDoc>>(
    filter: F
  ): Promise<{ deletedCount: number }>;

  countDocuments<const F extends MatchQuery<TDoc>>(filter?: F): Promise<number>;

  /**
   * P2 sugar (doc §6): find + server-side $lookup, compiled to a typed pipeline
   * under the hood. Prisma's `include` ergonomics; PipeSafe's inference. The
   * foreign schema and on-fields are validated exactly like Pipeline.lookup
   * (LookupForeignFieldOrError brands incompatible joins).
   */
  // findMany({ where, lookup: { author: { from: users, localField: "authorId", foreignField: "_id", justOne: true } } })

  /** Escape hatch, same philosophy as Pipeline.custom(): the raw driver collection. */
  raw(): unknown; // mongodb.Collection<TDoc>

  /** Register typed query interceptors — see §4. */
  use(extension: CollectionExtension<TDoc>): TypedCollection<TDoc>;
}

/* ------------------------------------------------------------------ */
/* 4. Hooks: typed query interceptors (Prisma-extensions shape,        */
/*    NOT kareem's invisible pre/post registry)                        */
/* ------------------------------------------------------------------ */

interface QueryDescription<TDoc extends Document> {
  filter: MatchQuery<TDoc>;
  options?: Record<string, unknown>;
  update?: UpdateQuery<TDoc>;
}

/**
 * One interceptor per operation kind — no name overloading across abstraction
 * levels (Mongoose's updateOne document-vs-query wart). Interceptors compose
 * in registration order and are async-only. Not calling next() replaces the
 * operation (e.g. soft delete rewrites deleteOne into an updateOne).
 */
interface CollectionExtension<TDoc extends Document> {
  query?: {
    find?: (
      q: QueryDescription<TDoc>,
      next: (q: QueryDescription<TDoc>) => Promise<TDoc[]>
    ) => Promise<TDoc[]>;
    updateOne?: (
      q: QueryDescription<TDoc>,
      next: (q: QueryDescription<TDoc>) => Promise<unknown>
    ) => Promise<unknown>;
    deleteOne?: (
      q: QueryDescription<TDoc>,
      next: (q: QueryDescription<TDoc>) => Promise<unknown>
    ) => Promise<unknown>;
    // ... one slot per verb
  };
  /** Write-time computed fields. TYPE-VISIBLE: adding a field changes TDoc downstream. */
  fields?: { [key: string]: (doc: TDoc) => unknown };
}

/* ------------------------------------------------------------------ */
/* 5. Transactions: driver retry loop + AsyncLocalStorage propagation  */
/* ------------------------------------------------------------------ */

/**
 * pipesafe.transaction wraps session.withTransaction (driver-native retry on
 * TransientTransactionError). Unlike Mongoose there is NO document state to
 * heal on retry — lean-by-default means the callback simply re-executes.
 * The session is stashed in AsyncLocalStorage; every Collection method and
 * Pipeline.execute() resolves options.session ?? als.getStore().
 */
declare const pipesafe: {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

/* ------------------------------------------------------------------ */
/* 6. Usage sketch                                                     */
/* ------------------------------------------------------------------ */

interface User {
  _id: ObjectId;
  email: string;
  age?: number;
  loginCount: number;
  tags: string[];
  address: { city: string; zip?: string };
  deletedAt?: Date;
}

declare const users: TypedCollection<User>;
declare const softDeletable: CollectionExtension<User>;

async function demo(userInput: unknown) {
  // Full-depth dotted paths + branded operators. Intended compile errors:
  //   { "address.cty": "Oslo" }   -> Field 'address.cty' is not on the schema.
  //   { email: { $gte: "a" } }    -> Operator '$gte' requires a number or Date field reference.
  const adults = await users.find(
    { "address.city": "Oslo", age: { $gte: 18 } },
    {
      projection: { email: 1, "address.city": 1 },
      sort: { email: 1 },
      limit: 50,
    }
  );
  // adults: Array<{ _id: ObjectId; email: string; address: { city: string } }>

  // orFail: no null-checking ceremony on the happy path.
  const user = await users.findOne({ email: "a@b.co" }).orFail();

  // sanitizeFilter: hostile input like { $gt: "" } is wrapped in $eq at runtime.
  await users.findOne({ email: userInput as string }, { sanitizeFilter: true });

  // Branded update operators. Intended compile errors:
  //   { $inc: { email: 1 } }  -> Operator '$inc' requires a field that infers to a number.
  //   { $push: { tags: 42 } } -> Operator '$push' requires a value assignable to the array element type.
  await users.updateOne(
    { _id: user._id },
    {
      $inc: { loginCount: 1 },
      $push: { tags: "beta" },
      $set: { "address.zip": "0150" },
    }
  );

  // Hooks: soft delete + tenancy filters, typed and composable.
  const safeUsers = users.use(softDeletable);
  await safeUsers.deleteOne({ _id: user._id }); // rewritten to $set: { deletedAt }

  // Transactions: no session threading; aggregations inside see it too.
  await pipesafe.transaction(async () => {
    await users.updateOne({ _id: user._id }, { $inc: { loginCount: -1 } });
    await users.updateOne({ email: "b@c.co" }, { $inc: { loginCount: 1 } });
  });

  return adults;
}

export { demo, TypedCollection };
export type { UpdateQuery, CollectionExtension };
