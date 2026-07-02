/**
 * SPIKE: Runtime schema & validation API (roadmap doc: plan/03-orm-roadmap.md, section 3)
 *
 * Purpose:  Illustrate the proposed P0/P1 runtime-schema surface — Standard Schema
 *           interop (Zod/Valibot/ArkType in), MongoDB $jsonSchema validator
 *           derivation (out), type-visible timestamps/defaults, and the
 *           null-vs-missing posture.
 * Status:   ILLUSTRATIVE ONLY — this API is not built. Shapes and names are a
 *           design sketch for discussion; they need not compile against the repo.
 * Build:    This file lives under plan/spikes/ and is EXCLUDED from the build,
 *           lint, and test pipelines. It is dependency-free by design: all
 *           external types (Standard Schema spec, driver types) are stubbed inline.
 */

/* ------------------------------------------------------------------ */
/* Inline stubs (real versions come from @standard-schema/spec + mongodb) */
/* ------------------------------------------------------------------ */

declare class ObjectId {
  toHexString(): string;
}

type Document = Record<string, any>;

/** PipeSafe's existing branded compile-time error (packages/core/src/utils/core.ts). */
interface PipeSafeError<Msg extends string> {
  readonly "~pipesafe.error": Msg;
}

/** Minimal slice of the Standard Schema v1 spec — the only new dependency. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string; // "zod" | "valibot" | "arktype" | ...
    readonly validate: (
      value: unknown
    ) =>
      | { value: Output; issues?: undefined }
      | {
          issues: ReadonlyArray<{
            message: string;
            path?: ReadonlyArray<PropertyKey>;
          }>;
        };
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

/* ------------------------------------------------------------------ */
/* 1. Collection definition: one schema drives runtime + types         */
/* ------------------------------------------------------------------ */

/** Options that shape BOTH runtime behavior and the inferred document type. */
interface CollectionSchemaOptions<S extends StandardSchemaV1> {
  /** Any Standard Schema — Zod, Valibot, ArkType. TS type is inferred, never written twice. */
  schema: S;

  /**
   * Adds `createdAt`/`updatedAt` (set via the hook system, §4 of the doc).
   * Crucially TYPE-VISIBLE: enabling this changes the inferred document type.
   * (Mongoose plugins cannot do this; chained generics make it natural.)
   */
  timestamps?: boolean;

  /**
   * Server-side enforcement: derive a $jsonSchema validator from `schema`
   * and reconcile it via `db sync` (doc §7). No codegen — sync is a runtime op.
   * - "strict":   validationLevel strict, validationAction error
   * - "moderate": existing docs exempt — brownfield adoption path
   * - "warn":     validationAction warn — audit before enforcing
   */
  validator?: { level: "strict" | "moderate" | "warn" };

  /** Declarative indexes, consumed by `db sync` (diff against listIndexes, then apply). */
  indexes?: ReadonlyArray<{
    keys: Record<string, 1 | -1 | "text">;
    options?: {
      unique?: boolean;
      sparse?: boolean;
      expireAfterSeconds?: number;
      name?: string;
    };
  }>;
}

/** Timestamps become part of the schema type when enabled — inference, not assertion. */
type WithTimestamps<T, Opts> =
  Opts extends { timestamps: true } ? T & { createdAt: Date; updatedAt: Date }
  : T;

/** Sketch of the typed handle. CRUD surface itself is in orm-crud-api.spike.ts. */
declare class SchemaCollection<TDoc extends Document> {
  /** Phantom — the single inferred document type used by CRUD, pipelines, and manifold. */
  readonly __outputType: TDoc;

  /** Aggregation entry point, unchanged: the schema type seeds the Pipeline generics. */
  aggregate(): unknown; // Pipeline<TDoc, TDoc> in the real thing

  /** Reconcile declared indexes + derived $jsonSchema against the live collection. */
  sync(options?: { dryRun?: boolean }): Promise<{
    indexes: { created: string[]; dropped: string[] };
    validator: "created" | "updated" | "unchanged";
  }>;
}

declare const db: {
  /** Existing untyped-schema form stays available (phantom generic, no runtime schema). */
  collection<TDoc extends Document>(name: string): SchemaCollection<TDoc>;

  /** New form: schema object in, everything inferred. */
  collection<
    S extends StandardSchemaV1,
    const Opts extends CollectionSchemaOptions<S>,
  >(
    name: string,
    options: Opts & CollectionSchemaOptions<S>
  ): SchemaCollection<WithTimestamps<InferOutput<S>, Opts>>;
};

/* ------------------------------------------------------------------ */
/* 2. Usage sketch (Zod stand-in)                                      */
/* ------------------------------------------------------------------ */

// Stub of a user-supplied Zod schema. Note the null-vs-missing distinction:
//   nickname?: string          -> key may be ABSENT   ($jsonSchema: not in `required`)
//   deactivatedAt: Date | null -> key present, NULLABLE (bsonType: ["date", "null"])
// PipeSafe preserves this (exactOptionalPropertyTypes posture); Prisma collapses it.
declare const UserSchema: StandardSchemaV1<
  unknown,
  {
    _id: ObjectId;
    email: string;
    age?: number;
    deactivatedAt: Date | null;
    address: { city: string; zip?: string };
  }
>;

const users = db.collection("users", {
  schema: UserSchema,
  timestamps: true,
  validator: { level: "moderate" },
  indexes: [{ keys: { email: 1 }, options: { unique: true } }],
});

// Inferred doc type — no interface written by hand, no codegen:
type User = typeof users.__outputType;
//   ^? { _id: ObjectId; email: string; age?: number; deactivatedAt: Date | null;
//        address: { city: string; zip?: string }; createdAt: Date; updatedAt: Date }

/* ------------------------------------------------------------------ */
/* 3. $jsonSchema derivation (design intent, not implementation)       */
/* ------------------------------------------------------------------ */

/**
 * deriveJsonSchema walks the vendor schema's structural metadata and emits a
 * MongoDB $jsonSchema. Rules pinned by the roadmap doc:
 *
 *  - optional key      -> omitted from `required`         (missing allowed)
 *  - `| null` member   -> "null" added to bsonType array  (null allowed)
 *  - ObjectId/Date/Decimal128 -> bsonType "objectId"/"date"/"decimal"
 *  - constructs Mongo can't express (refinements, transforms, regex lookahead)
 *    -> OMITTED from the validator, still checked client-side on insert.
 *    The deriver must be lossy-but-sound: the server validator is a superset
 *    of valid documents, never a stricter set than the client schema.
 */
declare function deriveJsonSchema(schema: StandardSchemaV1): {
  $jsonSchema: Document;
  /** Constructs that could not be represented server-side, for `sync --verbose`. */
  omissions: ReadonlyArray<{ path: string; reason: string }>;
};

// What users.sync() applies via collMod / createCollection:
const derived = deriveJsonSchema(UserSchema);
// e.g. { $jsonSchema: { bsonType: "object",
//        required: ["_id", "email", "deactivatedAt", "address"],
//        properties: { email: { bsonType: "string" },
//                      age: { bsonType: ["int", "double"] },
//                      deactivatedAt: { bsonType: ["date", "null"] }, ... } } }

/* ------------------------------------------------------------------ */
/* 4. Where runtime validation fires                                   */
/* ------------------------------------------------------------------ */

/**
 * Client-side: insertOne/insertMany/replaceOne run schema["~standard"].validate
 * on the full document (cheap, complete). A failure throws PipeSafeValidationError
 * carrying the Standard Schema issues array verbatim.
 *
 * Update operators get NO client-side validation in v1 — partial-document
 * validation is Mongoose's `runValidators` footgun. The derived server-side
 * $jsonSchema is the backstop for updates and for writes from other clients.
 *
 * Reads are NEVER validated or hydrated — lean by default, plain objects out.
 */
declare class PipeSafeValidationError extends Error {
  readonly issues: ReadonlyArray<{
    message: string;
    path?: ReadonlyArray<PropertyKey>;
  }>;
}

/* ------------------------------------------------------------------ */
/* 5. Compile-time posture unchanged                                   */
/* ------------------------------------------------------------------ */

// The runtime schema layer adds NO new compile-time error mechanism: filters,
// projections, and update operators keep firing the existing PipeSafeError
// brands (see orm-crud-api.spike.ts). Example of the shared grammar:
type ExampleBrand = PipeSafeError<"Field 'emial' is not on the schema.">;

export type { User, ExampleBrand };
export { users, derived };
