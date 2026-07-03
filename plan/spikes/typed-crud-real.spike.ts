/**
 * SPIKE: Typed CRUD on the REAL @pipesafe/core type machinery (EPIC-B, plan/03-orm-roadmap.md §2)
 *
 * Purpose:  Empirically answer the reuse questions behind plan/trd/EPIC-B-typed-crud.md:
 *           - Q1: Is the needed machinery (MatchQuery, ResolveMatchOutput,
 *                 ValidateProjectQuery, ResolveProjectOutput) publicly exported?
 *           - Q2: Does MatchQuery reuse "just work" as a find filter under the
 *                 `<const F extends MatchQuery<S>>` generic-constraint pattern —
 *                 including typo'd keys alone and next to valid keys?
 *           - Q3: Does ResolveMatchOutput/FilterUnion narrow union schemas in
 *                 find() results?
 *           - Q4: Does ValidateProjectQuery infer + validate from a NESTED
 *                 options.projection position, and does ResolveProjectOutput
 *                 narrow the returned document?
 *           - Q5: Update operators — which signature pattern fires branded
 *                 errors at the call site: key-restricted mapped types,
 *                 value-branded operands under a generic constraint, or a
 *                 validation-mapped intersection?
 *           - Q6: Insert with schema checking (optional _id, excess keys).
 *
 * How to typecheck (this file is NOT part of the repo build):
 *           /home/user/pipesafe/node_modules/.bin/tsc --noEmit \
 *             -p <scratchpad>/tsconfig.typed-crud.json
 *           where the tsconfig uses the repo's strict flags (strict,
 *           exactOptionalPropertyTypes, noUncheckedIndexedAccess,
 *           moduleResolution bundler) AND a `paths` shim:
 *             "@pipesafe/core":          ["packages/core/dist/index.d.mts"]
 *             "@pipesafe/core/stages/*": ["packages/core/dist/stages/*.d.mts"]
 *           The shim is required because MatchQuery / ResolveMatchOutput /
 *           ValidateProjectQuery / ResolveProjectOutput are NOT exported from
 *           the package root and no subpath exports exist (finding → CRUD-1).
 *           Add --extendedDiagnostics to compare instantiation counts against
 *           a raw-driver baseline (baseline-driver.ts in the scratchpad).
 *
 * Status:   SPIKE, not production. TypedCollection is a `declare class` — no
 *           runtime. `@ts-expect-error` directives pin intended rejections;
 *           an unfired directive fails the build, so both accepted and
 *           rejected cases are load-bearing.
 *
 * FINDINGS (tsc 5.9.3 against dist of @pipesafe/core 1.1.0; cross-checked
 *           on tsc 6.0.2 — identical results):
 *   Q1  NO. Only FieldSelector / InferFieldSelector / FieldSelectorsThatInferTo
 *       / GetFieldType / PipeSafeError / Prettify + test helpers are public.
 *       MatchQuery, ResolveMatchOutput, ValidateProjectQuery,
 *       ResolveProjectOutput, SetQuery, UnsetQuery resolve only via the paths
 *       shim → ticket CRUD-1.
 *   Q2  PARTLY — the plan/03 §2 claim "typo'd path ... = PipeSafeError" is
 *       WRONG for the plain generic-constraint pattern. Measured matrix:
 *         - operand brands ($gte on string, $size on non-array): fire. GOOD.
 *         - typo'd key ALONE, schema with NO array fields: fires (TS2353
 *           excess-property against the constraint). GOOD.
 *         - typo'd key ALONE, schema WITH array fields: COMPILES. FieldSelector
 *           emits template-literal keys (`tags.${number}`), whose pattern
 *           index signatures make every string key "known". The result type
 *           silently collapses to never[] (pinned below) — the exact silent
 *           degradation PipeSafeError exists to prevent.
 *         - typo'd key NEXT TO a valid key: COMPILES on every schema shape.
 *       Pipeline.match({ naem: "x" }) has the identical holes (verified) —
 *       pre-existing, but CRUD makes it a headline because find() is the
 *       first call every new user writes.
 *       THE FIX (verified below): intersection validation —
 *       `<const F extends MatchQuery<S>>(filter: F & ValidateMatchKeys<S, F>)`.
 *       Constraint keeps operand brands + result narrowing; the homomorphic
 *       intersection brands unknown keys (incl. dotted typos and keys inside
 *       $and/$or/$nor). All four matrix rows now reject. → CRUD-2, and a
 *       backport candidate for Pipeline.match (CRUD-9).
 *   Q3  YES. find({ status: "shipped" }) on a Pending|Shipped union returns
 *       exactly ShippedOrder[]; no discriminant → full union. Narrowing
 *       survives both the intersection parameter and the Promise position.
 *   Q4  YES. `<const P>` + ValidateProjectQuery infers from options.projection
 *       (nested one level inside an object parameter); mixed-mode and
 *       unknown-key brands fire there; ResolveProjectOutput narrows the
 *       returned document including dotted-key expansion
 *       ("address.city": 1 → { address: { city: string } }).
 *   Q5  Value-branded operands over ALL FieldSelector keys, under a generic
 *       constraint PLUS the same intersection trick for unknown paths, is the
 *       winning design. Key-restricted mapped types
 *       ({ [P in FieldSelectorsThatInferTo<S, number>]?: number }) fail two
 *       ways (pinned below): (a) rejections surface as unreadable key-set
 *       mismatches, not branded messages; (b) OPTIONAL numeric fields
 *       (age?: number) silently fall out of the key set — a false positive on
 *       a legal MongoDB update — because `number | undefined` does not extend
 *       `number`. Same undefined-poisoning applies to match.ts operand
 *       helpers: `{ age: { $gte: 18 } }` on `age?: number` is branded as an
 *       error TODAY (pinned below) → CRUD-3 must strip undefined in operand
 *       helpers; match.ts needs the same one-line fix.
 *   Q6  YES. A direct (non-generic) InsertDoc<TDoc> parameter gets freshness
 *       checks: missing required key, wrong value type, excess key all
 *       reject; _id optional at insert. CAVEAT: Omit-based InsertDoc does not
 *       distribute over union schemas — insert into TypedCollection<Order>
 *       needs a distributive version (noted in CRUD-5).
 *   Perf  --extendedDiagnostics, repo tsc 5.9.3, skipLibCheck on:
 *         this file (machinery + ~45 call sites): Types 6,530;
 *         Instantiations 23,440; Check time 0.36 s.
 *         Raw-driver baseline (mongodb Filter/UpdateFilter, same call
 *         shapes): Types 1,222; Instantiations 1,898; Check time 0.10 s.
 *         ~12x the driver's instantiations, but tiny in absolute terms —
 *         roughly 400-500 instantiations per validated call site, versus
 *         the ~3,600 project.ts documents for a single $project stage.
 *         plan/03 §2's compile-perf risk does not materialize at this
 *         scale; still gate wide/deep schemas in
 *         packages/core/benchmarking/ before shipping (CRUD-8).
 */

import type {
  Assert,
  Document,
  Equal,
  FieldSelector,
  FieldSelectorsThatInferTo,
  InferFieldSelector,
  PipeSafeError,
  Prettify,
} from "@pipesafe/core";
// NOT public exports — resolved via the tsconfig `paths` shim documented in
// the header. Making these real root exports is ticket CRUD-1.
import type {
  MatchQuery,
  ResolveMatchOutput,
} from "@pipesafe/core/stages/match";
import type {
  ResolveProjectOutput,
  ValidateProjectQuery,
} from "@pipesafe/core/stages/project";

/* ------------------------------------------------------------------ */
/* Test schemas                                                        */
/* ------------------------------------------------------------------ */

type User = {
  _id: string;
  email: string;
  name: string;
  age?: number;
  loginCount: number;
  tags: string[];
  address: { city: string; zip?: string };
  createdAt: Date;
};

type PendingOrder = { _id: string; status: "pending"; eta: Date };
type ShippedOrder = { _id: string; status: "shipped"; trackingId: string };
type Order = PendingOrder | ShippedOrder;

/* ------------------------------------------------------------------ */
/* Q2 fix: filter-key validation (future stages/match.ts addition)     */
/* ------------------------------------------------------------------ */

/**
 * The array hop goes through a type PARAMETER (A) so the homomorphic mapped
 * type maps tuple ELEMENTS. Mapping `{ [I in keyof F[K]]: ... }` inline maps
 * every array METHOD (push, map, ...) instead — measured dead end.
 */
type ValidateMatchArray<Schema extends Document, A> = {
  [I in keyof A]: ValidateMatchKeys<Schema, A[I]>;
};

/**
 * Brands unknown filter keys. Composes with the generic constraint as
 * `filter: F & ValidateMatchKeys<Schema, F>`: the constraint contributes
 * operand brands and drives ResolveMatchOutput narrowing; this mapped type
 * contributes unknown-key brands that the constraint provably cannot
 * (pattern index signatures from array-index selectors defeat both the
 * weak-type rule and excess-property checking — see header findings).
 */
type ValidateMatchKeys<Schema extends Document, F> = {
  [K in keyof F]: K extends "$and" | "$or" | "$nor" ?
    ValidateMatchArray<Schema, F[K]>
  : K extends FieldSelector<Schema> | "$expr" ? F[K]
  : PipeSafeError<`Field '${K & string}' is not on the schema.`>;
};

/* ------------------------------------------------------------------ */
/* Q5: typed update operators (future stages/update.ts)                */
/* ------------------------------------------------------------------ */

/**
 * Optionality note: InferFieldSelector<User, "age"> is `number | undefined`,
 * so operand helpers must strip `undefined` BEFORE the tuple-wrapped
 * compatibility check, or every optional field gets branded. match.ts's
 * NumericOperand does NOT do this today — see the pinned Q2 caveat below.
 */
type NonUndef<T> = Exclude<T, undefined>;

type NumericUpdateOperand<T, Op extends string> =
  [NonUndef<T>] extends [number] ? number
  : PipeSafeError<`Operator '${Op}' requires a field that infers to a number.`>;

type MinMaxUpdateOperand<T, Op extends string> =
  [NonUndef<T>] extends [number | Date] ? NonUndef<T>
  : PipeSafeError<`Operator '${Op}' requires a numeric or date field.`>;

type PushOperand<T, Op extends string> =
  [NonUndef<T>] extends [(infer U)[]] ?
    U | { $each: U[]; $position?: number; $slice?: number; $sort?: 1 | -1 }
  : PipeSafeError<`Operator '${Op}' requires an array field.`>;

type PullOperand<T, Op extends string> =
  [NonUndef<T>] extends [(infer U)[]] ? U
  : PipeSafeError<`Operator '${Op}' requires an array field.`>;

type CurrentDateOperand<T> =
  [NonUndef<T>] extends [Date] ? true | { $type: "date" | "timestamp" }
  : PipeSafeError<`Operator '$currentDate' requires a date field.`>;

/**
 * DESIGN A (winner): every operator maps over ALL FieldSelector keys and
 * brands incompatibility at the VALUE position — the TS2322 convention from
 * CLAUDE.md. Finite top-level $-keys → no index signature → the generic
 * constraint surfaces operand brands directly.
 */
type UpdateQuery<Schema extends Document> = {
  $set?: {
    [P in FieldSelector<Schema>]?: InferFieldSelector<Schema, P>;
  };
  $unset?: { [P in FieldSelector<Schema>]?: "" | true | 1 };
  $inc?: {
    [P in FieldSelector<Schema>]?: NumericUpdateOperand<
      InferFieldSelector<Schema, P>,
      "$inc"
    >;
  };
  $mul?: {
    [P in FieldSelector<Schema>]?: NumericUpdateOperand<
      InferFieldSelector<Schema, P>,
      "$mul"
    >;
  };
  $min?: {
    [P in FieldSelector<Schema>]?: MinMaxUpdateOperand<
      InferFieldSelector<Schema, P>,
      "$min"
    >;
  };
  $max?: {
    [P in FieldSelector<Schema>]?: MinMaxUpdateOperand<
      InferFieldSelector<Schema, P>,
      "$max"
    >;
  };
  $push?: {
    [P in FieldSelector<Schema>]?: PushOperand<
      InferFieldSelector<Schema, P>,
      "$push"
    >;
  };
  $addToSet?: {
    [P in FieldSelector<Schema>]?: PushOperand<
      InferFieldSelector<Schema, P>,
      "$addToSet"
    >;
  };
  $pull?: {
    [P in FieldSelector<Schema>]?: PullOperand<
      InferFieldSelector<Schema, P>,
      "$pull"
    >;
  };
  $currentDate?: {
    [P in FieldSelector<Schema>]?: CurrentDateOperand<
      InferFieldSelector<Schema, P>
    >;
  };
};

/** Unknown-path + unknown-operator brands, same intersection trick as filters. */
type ValidateUpdateOperandKeys<Schema extends Document, O> = {
  [P in keyof O]: P extends FieldSelector<Schema> ? O[P]
  : PipeSafeError<`Field '${P & string}' is not on the schema.`>;
};

type ValidateUpdateKeys<Schema extends Document, U> = {
  [K in keyof U]: K extends keyof UpdateQuery<Schema> ?
    ValidateUpdateOperandKeys<Schema, U[K]>
  : PipeSafeError<`Operator '${K & string}' is not a supported update operator.`>;
};

/**
 * DESIGN B (rejected — kept to pin WHY): restrict keys to selectors of the
 * right type, plain operand values. Failure modes pinned at `updateOneKR`
 * call sites and in the two assertions below.
 */
type UpdateQueryKeyRestricted<Schema extends Document> = {
  $inc?: { [P in FieldSelectorsThatInferTo<Schema, number>]?: number };
};

// Design-B failure (b): optional numeric fields fall out of the key set —
// `age?: number` infers to `number | undefined`, which does not extend
// `number`, so "age" is not an allowed $inc target at all.
type NumericSelectors = FieldSelectorsThatInferTo<User, number>;
type _designB_dropsOptionalAge = Assert<
  Equal<Extract<NumericSelectors, "age">, never>
>;
type _designB_keepsRequired = Assert<
  Equal<Extract<NumericSelectors, "loginCount">, "loginCount">
>;

/* ------------------------------------------------------------------ */
/* Q6: insert type                                                     */
/* ------------------------------------------------------------------ */

/**
 * _id becomes optional at insert time (driver generates it). NOTE: Omit does
 * not distribute over union schemas — production InsertDoc must distribute
 * (CRUD-5).
 */
type InsertDoc<TDoc extends Document> = Prettify<
  Omit<TDoc, "_id"> & { _id?: TDoc extends { _id: infer Id } ? Id : never }
>;

/* ------------------------------------------------------------------ */
/* The TypedCollection sketch (types only — signatures for the future  */
/* packages/core/src/collection/Collection.ts)                         */
/* ------------------------------------------------------------------ */

type ProjectedResult<TDoc extends Document, F, P> =
  [P] extends [undefined] ? Prettify<ResolveMatchOutput<F, TDoc>>
  : ResolveProjectOutput<P, ResolveMatchOutput<F, TDoc>>;

declare class TypedCollection<TDoc extends Document> {
  /**
   * Q2 (fixed pattern) + Q3 + Q4: constraint for operand brands and
   * narrowing, intersection for unknown-key brands, `<const P>` +
   * ValidateProjectQuery for projection inference from options.
   */
  find<const F extends MatchQuery<TDoc>, const P = undefined>(
    filter: F & ValidateMatchKeys<TDoc, F>,
    options?: {
      projection?: ValidateProjectQuery<TDoc, P>;
      sort?: { [K in FieldSelector<TDoc>]?: 1 | -1 };
      limit?: number;
      skip?: number;
    }
  ): Promise<ProjectedResult<TDoc, F, P>[]>;

  findOne<const F extends MatchQuery<TDoc>, const P = undefined>(
    filter: F & ValidateMatchKeys<TDoc, F>,
    options?: { projection?: ValidateProjectQuery<TDoc, P> }
  ): Promise<ProjectedResult<TDoc, F, P> | null>;

  /**
   * Q2 evidence: the plain generic-constraint signature (what plan/03 §2
   * prescribes, and what Pipeline.match uses today). Kept UNVALIDATED so the
   * holes stay pinned; do not ship this signature.
   */
  findPlain<const F extends MatchQuery<TDoc>>(
    filter: F
  ): Promise<Prettify<ResolveMatchOutput<F, TDoc>>[]>;

  /** Q6: schema-checked insert, optional _id. Direct typing → freshness. */
  insertOne(doc: InsertDoc<TDoc>): Promise<{ insertedId: TDoc["_id"] }>;

  /** Q5 Design A + intersection validation. */
  updateOne<
    const F extends MatchQuery<TDoc>,
    const U extends UpdateQuery<TDoc>,
  >(
    filter: F & ValidateMatchKeys<TDoc, F>,
    update: U & ValidateUpdateKeys<TDoc, U>
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  /** Q5 Design B: key-restricted mapped type (rejected; kept for evidence). */
  updateOneKR<
    const F extends MatchQuery<TDoc>,
    const U extends UpdateQueryKeyRestricted<TDoc>,
  >(
    filter: F,
    update: U
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  deleteOne<const F extends MatchQuery<TDoc>>(
    filter: F & ValidateMatchKeys<TDoc, F>
  ): Promise<{ deletedCount: number }>;

  countDocuments<const F extends MatchQuery<TDoc>>(
    filter?: F & ValidateMatchKeys<TDoc, F>
  ): Promise<number>;
}

declare const users: TypedCollection<User>;
declare const orders: TypedCollection<Order>;

/* ------------------------------------------------------------------ */
/* Q2 — the holes in the plain generic-constraint pattern (pinned)     */
/* ------------------------------------------------------------------ */

export async function q2_plainConstraintHoles() {
  // HOLE 1: typo'd key alone COMPILES on an array-bearing schema (the
  // template-literal selector `tags.${number}` creates a pattern index
  // signature that defeats weak-type + excess-property checks)...
  const ghost = await users.findPlain({ naem: "Ada" });
  // ...and the result silently collapses to never[] — FilterUnion matched
  // no union member. Silent never is the failure mode PipeSafeError exists
  // to prevent. If this assertion ever FAILS, the hole got fixed upstream:
  // move the @ts-expect-error onto the findPlain call and celebrate.
  type _silentNever = Assert<Equal<(typeof ghost)[number], never>>;

  // HOLE 2: typo'd key next to a valid key COMPILES (every schema shape).
  const ghost2 = await users.findPlain({ name: "Ada", naem: "Ada" });

  return { ghost, ghost2 };
}

/* ------------------------------------------------------------------ */
/* Q2 — MatchQuery reuse with the validated signature                  */
/* ------------------------------------------------------------------ */

export async function q2_matchQueryReuse() {
  // ACCEPT: full-depth dotted path + comparison operator on required number.
  const a = await users.find({
    "address.city": "Oslo",
    loginCount: { $gte: 10 },
  });
  type _a = Assert<Equal<(typeof a)[number], User>>;

  // ACCEPT: array operators, regex on string, logical $or.
  await users.find({ tags: { $size: 2 } });
  await users.find({ email: { $regex: /@corp\.example$/ } });
  await users.find({ $or: [{ name: "Ada" }, { loginCount: { $gte: 2 } }] });

  // REJECT: typo'd key alone.
  // @ts-expect-error 'naem' is not on the schema
  await users.find({ naem: "Ada" });

  // REJECT: typo'd key NEXT TO a valid key — the case the plain constraint
  // misses; fired by the ValidateMatchKeys intersection.
  // @ts-expect-error 'naem' is not on the schema even alongside valid keys
  await users.find({ name: "Ada", naem: "Ada" });

  // REJECT: typo'd dotted path.
  // @ts-expect-error 'address.cty' is not on the schema
  await users.find({ "address.cty": "Oslo" });

  // REJECT: typo inside a logical operator (recursion through $or).
  // @ts-expect-error 'naem' is not on the schema inside $or
  await users.find({ $or: [{ naem: "Ada" }] });

  // REJECT: operand brand — $gte on a string field (from the constraint).
  // @ts-expect-error Operator '$gte' requires a numeric or date field.
  await users.find({ email: { $gte: "a" } });

  // REJECT: operand brand — $size on a non-array field.
  // @ts-expect-error Operator '$size' requires an array field.
  await users.find({ loginCount: { $size: 1 } });

  // PINNED WART (pre-existing match.ts behavior, amplified for CRUD): $gte
  // on an OPTIONAL number field is branded because
  // NumericOperand<number | undefined> fails its tuple check — undefined is
  // not stripped. Legal MongoDB, rejected today. Fix in CRUD-3 (+ match.ts
  // one-liner); flip this pin when fixed.
  // @ts-expect-error currently branded: age?: number infers number|undefined
  await users.find({ age: { $gte: 18 } });

  return a;
}

/* ------------------------------------------------------------------ */
/* Q3 — union narrowing through find()                                 */
/* ------------------------------------------------------------------ */

export async function q3_unionNarrowing() {
  const shipped = await orders.find({ status: "shipped" });
  // ResolveMatchOutput/FilterUnion narrows to exactly the shipped variant.
  type _narrowed = Assert<Equal<(typeof shipped)[number], ShippedOrder>>;

  const pending = await orders.find({ status: "pending" });
  type _narrowedPending = Assert<Equal<(typeof pending)[number], PendingOrder>>;

  // No discriminant in the filter → full union preserved.
  const all = await orders.find({ _id: "abc" });
  type _union = Assert<Equal<(typeof all)[number], Order>>;

  return { shipped, pending, all };
}

/* ------------------------------------------------------------------ */
/* Q4 — typed projection narrowing the returned document               */
/* ------------------------------------------------------------------ */

export async function q4_projection() {
  // ACCEPT: inclusion projection with a dotted key, inferred from the
  // NESTED options.projection position.
  const row = await users.findOne(
    { loginCount: { $gte: 1 } },
    { projection: { email: 1, "address.city": 1 } }
  );
  type _projected = Assert<
    Equal<
      NonNullable<typeof row>,
      { _id: string; email: string; address: { city: string } }
    >
  >;

  // ACCEPT: exclusion projection drops the excluded key.
  const noEmail = await users.findOne(
    { name: "Ada" },
    { projection: { email: 0 } }
  );
  type _noEmail = Assert<
    Equal<
      "email" extends keyof NonNullable<typeof noEmail> ? true : false,
      false
    >
  >;

  // REJECT: mixed inclusion/exclusion (MongoDB runtime error, caught here).
  await users.findOne(
    { name: "Ada" },
    // @ts-expect-error Stage '$project' cannot mix inclusion and exclusion
    { projection: { email: 1, age: 0 } }
  );

  // REJECT: including an unknown key.
  await users.findOne(
    { name: "Ada" },
    // @ts-expect-error Field 'emial' is not on the schema.
    { projection: { emial: 1 } }
  );

  // No projection → schema (post-match-narrowing) comes back whole.
  const whole = await users.findOne({ name: "Ada" });
  type _whole = Assert<Equal<NonNullable<typeof whole>, User>>;

  return { row, noEmail, whole };
}

/* ------------------------------------------------------------------ */
/* Q5 — update operators: which pattern fires at the call site         */
/* ------------------------------------------------------------------ */

export async function q5_updateOperators() {
  // ACCEPT: the plan/03 headline example — $inc a number, $push a matching
  // element, $set a dotted optional path, $currentDate a Date field.
  await users.updateOne(
    { _id: "u1" },
    {
      $inc: { loginCount: 1 },
      $push: { tags: "beta" },
      $set: { "address.zip": "0150" },
      $currentDate: { createdAt: true },
    }
  );

  // ACCEPT: $push with $each modifier; $inc on an OPTIONAL number field —
  // Design A keeps optional fields addressable (NonUndef in the operand).
  await users.updateOne(
    { _id: "u1" },
    { $push: { tags: { $each: ["a", "b"] } }, $inc: { age: 1 } }
  );

  // REJECT: $inc on a string field → value-position brand (TS2322 shape).
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error Operator '$inc' requires a field that infers to a number.
    { $inc: { email: 1 } }
  );

  // REJECT: the brand fires even NEXT TO a valid operand.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error Operator '$inc' requires a field that infers to a number.
    { $inc: { loginCount: 1, email: 1 } }
  );

  // REJECT: $push wrong element type.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error '$push' element must match the array element type (string)
    { $push: { tags: 42 } }
  );

  // REJECT: $push on a non-array field.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error Operator '$push' requires an array field.
    { $push: { email: "x" } }
  );

  // REJECT: $set with the wrong value type.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error 'age' is number | undefined, not string
    { $set: { age: "forty" } }
  );

  // REJECT: unknown path under $set alone.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error 'naem' is not on the schema
    { $set: { naem: "Ada" } }
  );

  // REJECT: unknown path under $set next to a valid one — fired by the
  // ValidateUpdateKeys intersection (the plain constraint misses it, same
  // pattern-index-signature hole as filters).
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error 'naem' is not on the schema even alongside valid keys
    { $set: { name: "Ada", naem: "Ada" } }
  );

  // REJECT: unknown top-level update operator.
  await users.updateOne(
    { _id: "u1" },
    // @ts-expect-error '$becomes' is not a supported update operator
    { $becomes: { name: "Ada" } }
  );

  // --- Design B evidence (key-restricted): both directions are worse. ---

  // (a) $inc on a string field IS rejected, but as an unreadable key-set
  // mismatch — no branded message names the operator or constraint.
  await users.updateOneKR(
    { _id: "u1" },
    // @ts-expect-error rejected, but with an unhelpful key-set mismatch
    { $inc: { email: 1 } }
  );

  // (b) $inc on the OPTIONAL number field is REJECTED under Design B even
  // though it is a legal MongoDB update — "age" silently fell out of the
  // key set (see _designB_dropsOptionalAge above). False positive.
  await users.updateOneKR(
    { _id: "u1" },
    // @ts-expect-error Design B false positive: 'age' fell out of the key set
    { $inc: { age: 1 } }
  );
}

/* ------------------------------------------------------------------ */
/* Q6 — insert with schema checking                                    */
/* ------------------------------------------------------------------ */

export async function q6_insert() {
  // ACCEPT: full document without _id (driver generates it).
  await users.insertOne({
    email: "ada@corp.example",
    name: "Ada",
    loginCount: 0,
    tags: [],
    address: { city: "Oslo" },
    createdAt: new Date(),
  });

  // ACCEPT: explicit _id, optional field present.
  await users.insertOne({
    _id: "u2",
    email: "g@corp.example",
    name: "Grace",
    age: 36,
    loginCount: 0,
    tags: ["admiral"],
    address: { city: "Arlington", zip: "22201" },
    createdAt: new Date(),
  });

  // REJECT: missing required field (email).
  // @ts-expect-error 'email' is required
  await users.insertOne({
    name: "NoEmail",
    loginCount: 0,
    tags: [],
    address: { city: "Oslo" },
    createdAt: new Date(),
  });

  // REJECT: wrong value type.
  await users.insertOne({
    email: "x@corp.example",
    name: "X",
    // @ts-expect-error loginCount must be a number
    loginCount: "zero",
    tags: [],
    address: { city: "Oslo" },
    createdAt: new Date(),
  });

  // REJECT: excess key (direct typing → freshness check fires).
  await users.insertOne({
    email: "y@corp.example",
    name: "Y",
    loginCount: 0,
    tags: [],
    address: { city: "Oslo" },
    createdAt: new Date(),
    // @ts-expect-error 'nickname' is not a field of User
    nickname: "why",
  });
}

/* ------------------------------------------------------------------ */
/* delete / count — filter reuse only, no new machinery                */
/* ------------------------------------------------------------------ */

export async function q2b_deleteAndCount() {
  await users.deleteOne({ _id: "u1" });
  await users.countDocuments({ loginCount: { $gte: 1 } });

  // @ts-expect-error 'naem' is not on the schema
  await users.deleteOne({ naem: "Ada" });

  // @ts-expect-error Operator '$gte' requires a numeric or date field.
  await users.countDocuments({ email: { $gte: "a" } });
}

export type { UpdateQuery, ValidateMatchKeys, ValidateUpdateKeys, InsertDoc };
export { TypedCollection };
