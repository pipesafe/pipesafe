/**
 * SPIKE: Standard Schema in, MongoDB $jsonSchema out (roadmap doc: plan/03-orm-roadmap.md, section 3)
 *
 * Purpose:  Executable proof for EPIC-C (plan/trd/EPIC-C-runtime-schema-validation.md):
 *           1. A minimal schema builder whose values satisfy the inlined
 *              StandardSchemaV1 interface (runtime validate + inferred TS type)
 *              AND carry an introspectable descriptor — because Standard Schema
 *              has NO introspection API, $jsonSchema derivation must come from
 *              our own descriptor (or per-vendor adapters), never from `~standard`.
 *           2. deriveJsonSchema(): descriptor -> MongoDB $jsonSchema validator.
 *           3. Against a real mongod (MongoMemoryServer): server-side rejection
 *              (error code 121 DocumentValidationFailure + errInfo.details),
 *              null-vs-missing semantics, collMod validator updates, and the
 *              validationLevel / validationAction knobs.
 *
 * Run:      bun run tsx plan/spikes/standard-schema-jsonschema.spike.ts
 * Status:   SPIKE, not production code. Excluded from build/test pipelines.
 *
 * FINDINGS (filled in after execution on mongod 7.0.24):
 *  - Server rejection: MongoServerError code 121 (DocumentValidationFailure),
 *    errmsg "Document failed validation". NOTE: `err.codeName` is UNDEFINED on
 *    insert write errors (the driver surfaces the WriteError, which carries only
 *    code + errmsg + errInfo) — DX code must map 121 -> name itself.
 *    `errInfo.failingDocumentId` gives the _id. `errInfo.details` is a structured tree:
 *    { operatorName: "$jsonSchema", schemaRulesNotSatisfied: [...] } where each rule
 *    entry names the failing keyword ("required" -> missingProperties, "properties" ->
 *    propertiesNotSatisfied with per-property details, description, reason
 *    e.g. "type did not match", consideredValue, consideredType). Rich enough to map
 *    back to schema paths for DX (see SCHEMA-7). errInfo is present on writeErrors
 *    for insertMany too (per-doc).
 *  - Null vs missing: optional-absent passes when the key is omitted from `required`;
 *    optional-with-explicit-null FAILS unless "null" is in the bsonType array —
 *    exactly the exactOptionalPropertyTypes posture the roadmap demands. required +
 *    nullable ("deactivatedAt: Date | null") passes with null but fails when absent.
 *  - collMod validator swap works live and reports ok:1; existing non-conforming
 *    docs are untouched (validators check writes only, never data at rest).
 *  - validationLevel "moderate": updates to a PRE-EXISTING invalid doc succeed even
 *    when the update leaves it invalid; the same update against a conforming doc
 *    fails. "strict" (default) rejects both. This is the brownfield adoption knob.
 *  - validationAction "warn": invalid insert SUCCEEDS (write goes through) and the
 *    server logs the violation — the audit-before-enforce path. Driver surfaces no
 *    error at all, so PipeSafe cannot observe warn-mode violations client-side.
 *  - collMod also accepts validationLevel/validationAction changes independently
 *    of the validator body.
 *  - Surprise: bsonType "int" rejects JS doubles like 1.5 but ACCEPTS 42 sent from
 *    the driver (driver encodes small integral numbers as int32). `age: 42.5`
 *    fails with consideredType "double". For TS `number` fields the deriver must
 *    emit bsonType ["int", "double", "long"] (or "number" alias) — emitting bare
 *    "int" for z.number().int() is sound only because BSON ints stay ints.
 */

import process from "node:process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, MongoServerError, ObjectId } from "mongodb";

/* ------------------------------------------------------------------ */
/* 1. Inlined Standard Schema v1 spec (the real thing is ~30 lines;    */
/*    the spec uses a namespace — flattened here to standalone types)  */
/* ------------------------------------------------------------------ */

interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

/* ------------------------------------------------------------------ */
/* 2. Minimal schema builder: StandardSchemaV1 + introspectable        */
/*    descriptor. KEY POINT: `~standard` exposes only validate();      */
/*    deriveJsonSchema reads `descriptor`, which vendors don't have.   */
/* ------------------------------------------------------------------ */

type Descriptor =
  | { kind: "string"; optional: boolean; nullable: boolean }
  | { kind: "number"; int: boolean; optional: boolean; nullable: boolean }
  | { kind: "date"; optional: boolean; nullable: boolean }
  | { kind: "objectId"; optional: boolean; nullable: boolean }
  | {
      kind: "object";
      fields: Record<string, Descriptor>;
      optional: boolean;
      nullable: boolean;
    };

interface PField<Out> extends StandardSchemaV1<unknown, Out> {
  readonly descriptor: Descriptor;
  optional(): PField<Out | undefined>;
  nullable(): PField<Out | null>;
}

function makeField<Out>(
  descriptor: Descriptor,
  check: (v: unknown) => boolean,
  typeName: string
): PField<Out> {
  const validate = (value: unknown): StandardResult<Out> => {
    if (value === null && descriptor.nullable) return { value: value as Out };
    if (value === undefined && descriptor.optional)
      return { value: value as Out };
    if (check(value)) return { value: value as Out };
    return { issues: [{ message: `Expected ${typeName}` }] };
  };
  return {
    descriptor,
    "~standard": { version: 1, vendor: "pipesafe-spike", validate },
    optional() {
      return makeField<Out | undefined>(
        { ...descriptor, optional: true },
        check,
        typeName
      );
    },
    nullable() {
      return makeField<Out | null>(
        { ...descriptor, nullable: true },
        check,
        typeName
      );
    },
  };
}

const p = {
  string: () =>
    makeField<string>(
      { kind: "string", optional: false, nullable: false },
      (v) => typeof v === "string",
      "string"
    ),
  number: () =>
    makeField<number>(
      { kind: "number", int: false, optional: false, nullable: false },
      (v) => typeof v === "number",
      "number"
    ),
  int: () =>
    makeField<number>(
      { kind: "number", int: true, optional: false, nullable: false },
      (v) => typeof v === "number" && Number.isInteger(v),
      "integer"
    ),
  date: () =>
    makeField<Date>(
      { kind: "date", optional: false, nullable: false },
      (v) => v instanceof Date,
      "Date"
    ),
  objectId: () =>
    makeField<ObjectId>(
      { kind: "objectId", optional: false, nullable: false },
      (v) => v instanceof ObjectId,
      "ObjectId"
    ),
  object<F extends Record<string, PField<unknown>>>(fields: F) {
    type Out = {
      [K in keyof F]: InferOutput<F[K]>;
    };
    const descriptor: Descriptor = {
      kind: "object",
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, f]) => [k, f.descriptor])
      ),
      optional: false,
      nullable: false,
    };
    const validate = (value: unknown): StandardResult<Out> => {
      if (typeof value !== "object" || value === null)
        return { issues: [{ message: "Expected object" }] };
      const issues: StandardIssue[] = [];
      for (const [key, field] of Object.entries(fields)) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined && !(key in value)) {
          if (!field.descriptor.optional)
            issues.push({ message: "Required", path: [key] });
          continue;
        }
        const r = field["~standard"].validate(v);
        if (r instanceof Promise) throw new Error("async not supported");
        if (r.issues)
          issues.push(
            ...r.issues.map((i) => ({
              message: i.message,
              path: [key, ...(i.path ?? [])],
            }))
          );
      }
      return issues.length > 0 ? { issues } : { value: value as Out };
    };
    const make = (d: Descriptor): PField<Out> & { fields: F } =>
      ({
        descriptor: d,
        fields,
        "~standard": {
          version: 1 as const,
          vendor: "pipesafe-spike",
          validate,
        },
        optional: () => make({ ...d, optional: true }),
        nullable: () => make({ ...d, nullable: true }),
      }) as unknown as PField<Out> & { fields: F };
    return make(descriptor);
  },
};

/* ------------------------------------------------------------------ */
/* 3. deriveJsonSchema: descriptor walk -> MongoDB $jsonSchema         */
/* ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

function bsonTypesFor(d: Descriptor): string[] {
  const base: string[] =
    d.kind === "string" ? ["string"]
    : d.kind === "number" ?
      d.int ?
        ["int", "long"]
      : ["int", "long", "double", "decimal"]
    : d.kind === "date" ? ["date"]
    : d.kind === "objectId" ? ["objectId"]
    : ["object"];
  return d.nullable ? [...base, "null"] : base;
}

function deriveJsonSchema(descriptor: Descriptor): JsonSchema {
  if (descriptor.kind !== "object")
    throw new Error("top-level schema must be an object");
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(descriptor.fields)) {
    // NULL VS MISSING, the load-bearing rule:
    //   optional  -> key omitted from `required` (absence allowed)
    //   nullable  -> "null" appended to bsonType (explicit null allowed)
    if (!field.optional) required.push(key);
    properties[key] =
      field.kind === "object" ?
        {
          ...deriveJsonSchema({ ...field, nullable: false }),
          bsonType: bsonTypesFor(field),
        }
      : { bsonType: bsonTypesFor(field) };
  }
  const out: JsonSchema = { bsonType: "object", properties };
  if (required.length > 0) out.required = required;
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. The runtime experiment                                           */
/* ------------------------------------------------------------------ */

const UserSchema = p.object({
  _id: p.objectId(),
  email: p.string(),
  age: p.int().optional(), // optional: key may be ABSENT, but not null
  deactivatedAt: p.date().nullable(), // required key, null allowed
  profile: p.object({ bio: p.string() }).optional(),
});

type User = InferOutput<typeof UserSchema>;
// Compile-time check that inference works (age?: number via | undefined):
const _typeProbe: User = {
  _id: new ObjectId(),
  email: "a@b.c",
  age: undefined,
  deactivatedAt: null,
  profile: undefined,
};
void _typeProbe;

function logServerError(label: string, err: unknown) {
  if (!(err instanceof MongoServerError)) throw err;
  console.log(`\n--- ${label} ---`);
  console.log(`code=${String(err.code)} codeName=${err.codeName ?? "?"}`);
  console.log(`errmsg=${err.message}`);
  console.log("errInfo=", JSON.stringify(err.errInfo, null, 2));
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db("spike");

  const validator = { $jsonSchema: deriveJsonSchema(UserSchema.descriptor) };
  console.log("derived validator:\n", JSON.stringify(validator, null, 2));

  // -- createCollection with validator (default: strict/error) --------
  await db.createCollection("users", { validator });
  const users = db.collection("users");

  // 4a. Client-side Standard Schema validation (what insertOne will run)
  const bad = { email: 42, deactivatedAt: null };
  const clientResult = UserSchema["~standard"].validate(bad);
  console.log(
    "\nclient-side issues:",
    JSON.stringify("issues" in (clientResult as object) ? clientResult : null)
  );

  // 4b. Server-side rejection: wrong type
  try {
    await users.insertOne({
      _id: new ObjectId(),
      email: 42,
      deactivatedAt: null,
    });
    console.log("UNEXPECTED: bad insert passed");
  } catch (err) {
    logServerError(
      "insert rejected: email is a number (code should be 121)",
      err
    );
  }

  // 4c. Server-side rejection: missing required field
  try {
    await users.insertOne({ _id: new ObjectId(), email: "a@b.c" }); // no deactivatedAt
    console.log("UNEXPECTED: missing-required insert passed");
  } catch (err) {
    logServerError("insert rejected: required 'deactivatedAt' missing", err);
  }

  // 4d. Null-vs-missing matrix
  console.log("\n--- null vs missing matrix ---");
  const cases: [string, Record<string, unknown>][] = [
    [
      "optional 'age' ABSENT (should pass)",
      { _id: new ObjectId(), email: "x@y.z", deactivatedAt: null },
    ],
    [
      "optional 'age' explicit null (should FAIL: optional != nullable)",
      { _id: new ObjectId(), email: "x@y.z", age: null, deactivatedAt: null },
    ],
    [
      "nullable 'deactivatedAt' = null (should pass)",
      { _id: new ObjectId(), email: "x@y.z", deactivatedAt: null },
    ],
    [
      "int field 'age' = 42.5 (should FAIL bsonType int)",
      { _id: new ObjectId(), email: "x@y.z", age: 42.5, deactivatedAt: null },
    ],
    [
      "int field 'age' = 42 (should pass: driver encodes int32)",
      { _id: new ObjectId(), email: "x@y.z", age: 42, deactivatedAt: null },
    ],
  ];
  for (const [label, doc] of cases) {
    try {
      await users.insertOne(doc);
      console.log(`PASS  ${label}`);
    } catch (err) {
      if (!(err instanceof MongoServerError)) throw err;
      const details = err.errInfo?.details as
        | { schemaRulesNotSatisfied?: unknown }
        | undefined;
      console.log(
        `REJECT ${label}\n       first rule: ${JSON.stringify(details?.schemaRulesNotSatisfied)?.slice(0, 200)}`
      );
    }
  }

  // 4e. collMod: swap validator + switch validationAction to "warn"
  console.log("\n--- collMod: validationAction warn ---");
  const collModRes = await db.command({
    collMod: "users",
    validator,
    validationLevel: "strict",
    validationAction: "warn",
  });
  console.log("collMod ok:", collModRes.ok);
  const warnInsert = await users.insertOne({
    _id: new ObjectId(),
    email: 999,
    deactivatedAt: null,
  });
  console.log(
    "warn mode: invalid insert SUCCEEDED (acknowledged:",
    warnInsert.acknowledged,
    ") -- violation only in server log"
  );

  // 4f. validationLevel moderate: pre-existing invalid docs are exempt
  console.log("\n--- validationLevel moderate ---");
  // seed one CONFORMING doc while action is still "warn" (any doc would pass anyway)
  await users.insertOne({
    _id: new ObjectId(),
    email: "x@y.z",
    deactivatedAt: null,
  });
  await db.command({
    collMod: "users",
    validationAction: "error",
    validationLevel: "moderate",
  });
  // the warn-mode doc above is invalid and now lives in the collection
  const invalidId = warnInsert.insertedId;
  const updRes = await users.updateOne(
    { _id: invalidId },
    { $set: { email: 1000 } }
  );
  console.log(
    "moderate: update keeping pre-existing doc invalid ->",
    updRes.modifiedCount === 1 ? "ALLOWED" : "blocked"
  );
  const goodDoc = await users.findOne({ email: "x@y.z" });
  try {
    await users.updateOne({ _id: goodDoc?._id }, { $set: { email: 123 } });
    console.log(
      "UNEXPECTED: invalidating a conforming doc passed under moderate"
    );
  } catch (err) {
    if (!(err instanceof MongoServerError)) throw err;
    console.log(
      `moderate: invalidating a CONFORMING doc -> rejected (code ${String(err.code)})`
    );
  }
  await db.command({ collMod: "users", validationLevel: "strict" });
  try {
    await users.updateOne({ _id: invalidId }, { $set: { email: 1001 } });
    console.log("UNEXPECTED: strict allowed update to invalid doc");
  } catch (err) {
    if (!(err instanceof MongoServerError)) throw err;
    console.log(
      `strict: same update on pre-existing invalid doc -> rejected (code ${String(err.code)})`
    );
  }

  // 4g. collMod validator replacement (schema evolution path for db sync)
  console.log("\n--- collMod: validator replacement ---");
  const v2 = p.object({
    _id: p.objectId(),
    email: p.string(),
    age: p.int().optional(),
    deactivatedAt: p.date().nullable(),
    tier: p.string(), // new required field
  });
  const res2 = await db.command({
    collMod: "users",
    validator: { $jsonSchema: deriveJsonSchema(v2.descriptor) },
  });
  console.log("collMod swap ok:", res2.ok);
  try {
    await users.insertOne({
      _id: new ObjectId(),
      email: "new@v2.io",
      deactivatedAt: null,
    });
  } catch (err) {
    if (!(err instanceof MongoServerError)) throw err;
    console.log(
      "new validator live: insert without 'tier' rejected, code",
      err.code
    );
  }
  const opts = (await db.listCollections({ name: "users" }).toArray())[0]
    ?.options;
  console.log(
    "listCollections roundtrip: validationLevel =",
    (opts as { validationLevel?: string }).validationLevel,
    "| validator has 'tier' in required:",
    JSON.stringify(
      (opts as { validator?: { $jsonSchema?: { required?: string[] } } })
        .validator?.$jsonSchema?.required ?? []
    )
  );

  await client.close();
  await mongod.stop();
  console.log("\nspike complete");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
