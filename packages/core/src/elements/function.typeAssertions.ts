/**
 * $function type assertions
 *
 * Pins the correlation behavior: a $function's `args` determine the body's
 * expected parameter types, so a wrong annotation or wrong arity fails at
 * the body with a native TS error — at ANY nesting depth. The expression's
 * result type is the body's return type (undefined/void normalize to null).
 *
 * Unannotated params: at TOP-LEVEL keys of set/project (and replaceRoot's
 * newRoot), `FunctionSlots` supplies computed contextual types — `(a) => a`
 * with `args: ["$age"]` gets `a: number` with no annotation. Everywhere
 * else (nested in $add/$cond/accumulators, match $expr) there is no
 * inference site for args, and the signature-less `Function` body slot
 * means unannotated params fail loudly as TS7006 — never silently `any`.
 */

import { Assert, AssertPipeSafeError, Equal } from "../utils/tests";
import { Pipeline, InferOutputType } from "../pipeline/Pipeline";
import { InferExpression, ServerFunctionRef } from "./expressions";

type User = {
  _id: string;
  name: string;
  age: number;
  score?: number | undefined;
  rating: number | null;
  tags: string[];
  joinedAt: Date;
};

// ============================================================================
// Result-type inference — body return type flows into the output schema
// ============================================================================

// Test 1: simple numeric body over a field-reference arg
const doubled = new Pipeline<User>().set({
  doubled: {
    $function: { body: (a: number) => a * 2, args: ["$age"], lang: "js" },
  },
});
type DoubledTest = Assert<
  Equal<InferOutputType<typeof doubled>["doubled"], number>
>;

// Test 2: multiple args — field refs, literals, and nested expressions all
// resolve to their runtime types. (Note: string literals must start with an
// alphanumeric character — the codebase-wide `NoDollarString` convention
// that keeps literals distinguishable from `$` field references.)
const mixedArgs = new Pipeline<User>().set({
  label: {
    $function: {
      body: (name: string, sep: string, agePlusOne: number) =>
        name + sep + String(agePlusOne),
      args: ["$name", "x", { $add: ["$age", 1] }],
      lang: "js",
    },
  },
});
type MixedArgsTest = Assert<
  Equal<InferOutputType<typeof mixedArgs>["label"], string>
>;

// Test 3: array field reference resolves to the array type
const tagCount = new Pipeline<User>().set({
  tagCount: {
    $function: {
      body: (tags: string[]) => tags.length,
      args: ["$tags"],
      lang: "js",
    },
  },
});
type TagCountTest = Assert<
  Equal<InferOutputType<typeof tagCount>["tagCount"], number>
>;

// Test 4: optional field arg — only `undefined` is stripped (BSON has no
// undefined), so the param is `number`.
const fromOptional = new Pipeline<User>().set({
  bumped: {
    $function: { body: (s: number) => s + 1, args: ["$score"], lang: "js" },
  },
});
type FromOptionalTest = Assert<
  Equal<InferOutputType<typeof fromOptional>["bumped"], number>
>;

// Test 4b: a NULLABLE field keeps its `null` — the server passes null through,
// so the param type is `number | null`, and a body that handles null infers a
// `number` result.
const fromNullable = new Pipeline<User>().set({
  ratingOr0: {
    $function: {
      body: (r: number | null) => r ?? 0,
      args: ["$rating"],
      lang: "js",
    },
  },
});
type FromNullableTest = Assert<
  Equal<InferOutputType<typeof fromNullable>["ratingOr0"], number>
>;

// A non-null annotation is REJECTED for a nullable arg — proves `null` is not
// silently stripped (before the fix `$rating` resolved to `number`).
const _nullableRejectsNarrow = new Pipeline<User>().set({
  bad: {
    $function: {
      // @ts-expect-error  '$rating' resolves to number | null; a `number` param cannot accept null
      body: (r: number) => r,
      args: ["$rating"],
      lang: "js",
    },
  },
});

// Test 4c: an object-literal arg resolves nested `$field` references at depth.
// `{ n: "$name", a: "$age" }` becomes `{ n: string; a: number }`; this body
// only type-checks because the refs are resolved (not left as the literal
// strings "$name"/"$age").
const objectArg = new Pipeline<User>().set({
  combined: {
    $function: {
      body: (o: { n: string; a: number }) => o.n + String(o.a),
      args: [{ n: "$name", a: "$age" }],
      lang: "js",
    },
  },
});
type ObjectArgTest = Assert<
  Equal<InferOutputType<typeof objectArg>["combined"], string>
>;

// Test 5: wider annotation than the arg type is allowed (contravariance)
const widerAnnotation = new Pipeline<User>().set({
  safe: {
    $function: {
      body: (a: number | null) => a ?? 0,
      args: ["$age"],
      lang: "js",
    },
  },
});
type WiderAnnotationTest = Assert<
  Equal<InferOutputType<typeof widerAnnotation>["safe"], number>
>;

// ============================================================================
// Rejections — wrong annotation / wrong arity / unannotated params
// ============================================================================

const _wrongAnnotation = new Pipeline<User>().set({
  bad: {
    // @ts-expect-error  param annotated string but '$age' resolves to number
    $function: { body: (a: string) => a.length, args: ["$age"], lang: "js" },
  },
});

const _wrongArity = new Pipeline<User>().set({
  bad: {
    $function: {
      // @ts-expect-error  two params but only one arg
      body: (a: number, b: number) => a + b,
      args: ["$age"],
      lang: "js",
    },
  },
});

// ============================================================================
// Unannotated params at top-level keys — FunctionSlots contextual typing
// ============================================================================

// Test U1: `(a) => a` gets `a: number` from args with NO annotation, and
// the return type flows through (number, not any/brand)
const unannotated = new Pipeline<User>().set({
  echoed: { $function: { body: (a) => a, args: ["$age"], lang: "js" } },
});
type UnannotatedParamTest = Assert<
  Equal<InferOutputType<typeof unannotated>["echoed"], number>
>;

// Test U2: multiple unannotated params, mixed arg kinds
const unannotatedMulti = new Pipeline<User>().set({
  label: {
    $function: {
      body: (n, count) => n.repeat(count),
      args: ["$name", { $add: ["$age", 1] }],
      lang: "js",
    },
  },
});
type UnannotatedMultiTest = Assert<
  Equal<InferOutputType<typeof unannotatedMulti>["label"], string>
>;

// Test U3: unannotated alongside plain values and other expressions
const unannotatedMixed = new Pipeline<User>().set({
  plain: 5,
  viaAdd: { $add: ["$age", 1] },
  shouted: {
    $function: {
      body: (n) => `${n.toUpperCase()}!`,
      args: ["$name"],
      lang: "js",
    },
  },
});
type UnannotatedMixedTest = Assert<
  Equal<InferOutputType<typeof unannotatedMixed>["shouted"], string>
>;

// Test U4: project gets the same treatment
const unannotatedProject = new Pipeline<User>().project({
  name: 1,
  half: { $function: { body: (a) => a / 2, args: ["$age"], lang: "js" } },
});
type UnannotatedProjectTest = Assert<
  Equal<InferOutputType<typeof unannotatedProject>["half"], number>
>;

// Test U5: unannotated params with a WRONG usage inside the body are caught
// (the param really is `number`, not `any`)
const _unannotatedBodyChecked = new Pipeline<User>().set({
  bad: {
    $function: {
      // @ts-expect-error  `a` is number — string method does not exist
      body: (a) => a.toUpperCase(),
      args: ["$age"],
      lang: "js",
    },
  },
});

// NESTED unannotated params have no args inference site — they fail loudly
// as TS7006 (implicit any) instead of becoming silent `any`. (Contextual
// typing for nested $functions is achievable but costs seconds of
// typecheck per call site — see FunctionSlots in elements/function.ts.)
const _nestedUnannotated = new Pipeline<User>().set({
  total: {
    $add: [
      1,
      {
        $function: {
          // @ts-expect-error  nested body params need annotations (TS7006)
          body: (a) => a * 3,
          args: ["$age"],
          lang: "js",
        },
      },
    ],
  },
});

// Annotated nested bodies work at any depth and stay fully validated
const deepAnnotated = new Pipeline<User>().set({
  bonus: {
    $cond: [
      { $gt: ["$age", 18] },
      {
        $add: [
          1,
          {
            $function: {
              body: (a: number) => a * 2,
              args: ["$age"],
              lang: "js",
            },
          },
        ],
      },
      0,
    ],
  },
});
type DeepAnnotatedTest = Assert<
  Equal<InferOutputType<typeof deepAnnotated>["bonus"], number>
>;

// match $expr still requires annotations (MatchQuery's union constraint is
// incompatible with the FunctionSlots inference shape — the extra type
// variables make the match literal collapse to its constraint)
const _matchUnannotated = new Pipeline<User>().match({
  $expr: {
    $function: {
      // @ts-expect-error  match $expr body params need annotations (TS7006)
      body: (a) => a > 18,
      args: ["$age"],
      lang: "js",
    },
  },
});

// An explicitly any-returning body brands the same way
const anyReturn = new Pipeline<User>().set({
  parsed: {
    $function: {
      body: (n: string): any => JSON.parse(n),
      args: ["$name"],
      lang: "js",
    },
  },
});
type AnyReturnBrandTest = Assert<
  AssertPipeSafeError<
    InferOutputType<typeof anyReturn>["parsed"],
    "Operator '$function' requires explicitly typed body parameters and a non-'any' return type."
  >
>;

// ============================================================================
// $$-system variables as args
// ============================================================================

// A `$$`-system variable is a valid arg whose runtime type is not modeled:
// ANY annotation is accepted (the expected param is permissive), and the
// body's return type still flows into the output schema.
const systemVarArg = new Pipeline<User>().set({
  stamped: {
    $function: {
      body: (now: Date, n: string) => `${n}@${now.getTime()}`,
      args: ["$$NOW", "$name"],
      lang: "js",
    },
  },
});
type SystemVarArgTest = Assert<
  Equal<InferOutputType<typeof systemVarArg>["stamped"], string>
>;

// An UNANNOTATED param bound to a `$$`-var contextually types as `any`,
// drags the return type to `any`, and the output brands (loud — fixed by
// annotating) instead of leaking `any`.
const systemVarUnannotated = new Pipeline<User>().set({
  stamped: {
    $function: { body: (now) => now, args: ["$$NOW"], lang: "js" },
  },
});
type SystemVarUnannotatedTest = Assert<
  AssertPipeSafeError<
    InferOutputType<typeof systemVarUnannotated>["stamped"],
    "Operator '$function' requires explicitly typed body parameters and a non-'any' return type."
  >
>;

// ============================================================================
// Return-type normalization — BSON has no undefined
// ============================================================================

// Test 6: undefined return becomes null
const returnsUndefined = new Pipeline<User>().set({
  nothing: {
    $function: { body: () => undefined, args: [], lang: "js" },
  },
});
type ReturnsUndefinedTest = Assert<
  Equal<InferOutputType<typeof returnsUndefined>["nothing"], null>
>;

// Test 7: void return becomes null
const returnsVoid = new Pipeline<User>().set({
  nothing: {
    $function: {
      body: () => {
        return;
      },
      args: [],
      lang: "js",
    },
  },
});
type ReturnsVoidTest = Assert<
  Equal<InferOutputType<typeof returnsVoid>["nothing"], null>
>;

// Test 8: `string | undefined` becomes `string | null`
const maybeString = new Pipeline<User>().set({
  maybe: {
    $function: {
      body: (n: string) => (n.length > 2 ? n : undefined),
      args: ["$name"],
      lang: "js",
    },
  },
});
type MaybeStringTest = Assert<
  Equal<InferOutputType<typeof maybeString>["maybe"], string | null>
>;

// ============================================================================
// Nested correlation — never `any`, at any depth
// ============================================================================

// Test 9: nested inside $add — still resolves, $add output stays number
const nestedInAdd = new Pipeline<User>().set({
  total: {
    $add: [
      1,
      { $function: { body: (a: number) => a * 3, args: ["$age"], lang: "js" } },
    ],
  },
});
type NestedInAddTest = Assert<
  Equal<InferOutputType<typeof nestedInAdd>["total"], number>
>;

// Test 9b: nested wrong annotation rejected
const _nestedWrongAnnotation = new Pipeline<User>().set({
  total: {
    $add: [
      1,
      {
        $function: {
          // @ts-expect-error  nested body annotated string but '$age' is number
          body: (a: string) => a.length,
          args: ["$age"],
          lang: "js",
        },
      },
    ],
  },
});

// Test 10: nested inside $cond branches
const nestedInCond = new Pipeline<User>().set({
  graded: {
    $cond: [
      { $gte: ["$age", 18] },
      {
        $function: {
          body: (n: string) => n.toUpperCase(),
          args: ["$name"],
          lang: "js",
        },
      },
      "minor",
    ],
  },
});
type NestedInCondTest = Assert<
  Equal<InferOutputType<typeof nestedInCond>["graded"], string | "minor">
>;

// Test 11: $function inside another $function's args — inner return type
// is the outer's expected param type
const nestedInFunction = new Pipeline<User>().set({
  chained: {
    $function: {
      body: (x: number) => x + 1,
      args: [{ $function: { body: () => 5, args: [], lang: "js" } }],
      lang: "js",
    },
  },
});
type NestedInFunctionTest = Assert<
  Equal<InferOutputType<typeof nestedInFunction>["chained"], number>
>;

// Test 11b: inner $function's own correlation still enforced at depth two
const _innerWrongAnnotation = new Pipeline<User>().set({
  chained: {
    $function: {
      body: (x: number) => x + 1,
      args: [
        {
          $function: {
            // @ts-expect-error  inner body annotated string but '$age' is number
            body: (a: string) => a.length,
            args: ["$age"],
            lang: "js",
          },
        },
      ],
      lang: "js",
    },
  },
});

// ============================================================================
// Other stages — project / match $expr / group / replaceRoot
// ============================================================================

// Test 12: project — computed field
const projected = new Pipeline<User>().project({
  name: 1,
  shout: {
    $function: { body: (n: string) => `${n}!`, args: ["$name"], lang: "js" },
  },
});
type ProjectedTest = Assert<
  Equal<InferOutputType<typeof projected>["shout"], string>
>;

const _projectWrongAnnotation = new Pipeline<User>().project({
  shout: {
    $function: {
      // @ts-expect-error  param annotated number but '$name' resolves to string
      body: (n: number) => n + 1,
      args: ["$name"],
      lang: "js",
    },
  },
});

// Test 13: match $expr — body correlated with args
const matched = new Pipeline<User>().match({
  $expr: {
    $function: { body: (a: number) => a > 18, args: ["$age"], lang: "js" },
  },
});
type MatchedTest = Assert<Equal<InferOutputType<typeof matched>, User>>;

const _matchWrongAnnotation = new Pipeline<User>().match({
  $expr: {
    $function: {
      // @ts-expect-error  param annotated string but '$age' resolves to number
      body: (a: string) => a.length > 2,
      args: ["$age"],
      lang: "js",
    },
  },
});

// Test 14: group — $function as a $push operand
const grouped = new Pipeline<User>().group({
  _id: "$name",
  ageLabels: {
    $push: {
      $function: { body: (a: number) => `${a}`, args: ["$age"], lang: "js" },
    },
  },
});
type GroupedTest = Assert<
  Equal<InferOutputType<typeof grouped>["ageLabels"], string[]>
>;

const _groupWrongAnnotation = new Pipeline<User>().group({
  _id: "$name",
  ageLabels: {
    $push: {
      $function: {
        // @ts-expect-error  param annotated string but '$age' resolves to number
        body: (a: string) => a.length,
        args: ["$age"],
        lang: "js",
      },
    },
  },
});

// Test 15: replaceRoot — $function inside the newRoot object
const replaced = new Pipeline<User>().replaceRoot({
  newRoot: {
    id: "$_id",
    velocity: {
      $function: { body: (a: number) => a / 2, args: ["$age"], lang: "js" },
    },
  },
});
// (readonly modifiers come from `<const R>` inference of the object
// literal — pre-existing replaceRoot behavior, not $function-specific)
type ReplacedTest = Assert<
  Equal<
    InferOutputType<typeof replaced>,
    { readonly id: string; readonly velocity: number }
  >
>;

// ============================================================================
// serverFn references — typing flows from the referenced function
// ============================================================================

declare const applyTaxRef: ServerFunctionRef<(price: number) => number>;

// Test 16: file-based body — return type flows, args validated against fn
const taxed = new Pipeline<User>().set({
  taxed: {
    $function: { body: applyTaxRef, args: ["$age"], lang: "js" },
  },
});
type TaxedTest = Assert<Equal<InferOutputType<typeof taxed>["taxed"], number>>;

declare const stringRef: ServerFunctionRef<(s: string) => number>;

const _serverFnWrongArg = new Pipeline<User>().set({
  bad: {
    // @ts-expect-error  ref takes string but '$age' resolves to number
    $function: { body: stringRef, args: ["$age"], lang: "js" },
  },
});

// ============================================================================
// InferExpression directly (annotated literal — no call site involved)
// ============================================================================

type DirectInfer = InferExpression<
  User,
  { $function: { body: (a: number) => boolean; args: ["$age"]; lang: "js" } }
>;
type DirectInferTest = Assert<Equal<DirectInfer, boolean>>;

// An any-returning body never leaks `any` into the output — it brands
type AnyReturnInfer = InferExpression<
  User,
  { $function: { body: (a: number) => any; args: ["$age"]; lang: "js" } }
>;
type AnyReturnInferTest = Assert<
  AssertPipeSafeError<
    AnyReturnInfer,
    "Operator '$function' requires explicitly typed body parameters and a non-'any' return type."
  >
>;

// Keep value bindings "used" for noUnusedLocals
void doubled;
void mixedArgs;
void tagCount;
void fromOptional;
void fromNullable;
void objectArg;
void widerAnnotation;
void returnsUndefined;
void returnsVoid;
void maybeString;
void nestedInAdd;
void nestedInCond;
void nestedInFunction;
void projected;
void matched;
void grouped;
void replaced;
void taxed;
void unannotated;
void unannotatedMulti;
void unannotatedMixed;
void unannotatedProject;
void anyReturn;
void _wrongAnnotation;
void _wrongArity;
void _nullableRejectsNarrow;
void _unannotatedBodyChecked;
void _nestedUnannotated;
void deepAnnotated;
void _matchUnannotated;
void _nestedWrongAnnotation;
void _innerWrongAnnotation;
void _projectWrongAnnotation;
void _matchWrongAnnotation;
void _groupWrongAnnotation;
void _serverFnWrongArg;
void systemVarArg;
void systemVarUnannotated;

export type {
  DoubledTest,
  MixedArgsTest,
  TagCountTest,
  FromOptionalTest,
  FromNullableTest,
  ObjectArgTest,
  WiderAnnotationTest,
  ReturnsUndefinedTest,
  ReturnsVoidTest,
  MaybeStringTest,
  NestedInAddTest,
  NestedInCondTest,
  NestedInFunctionTest,
  ProjectedTest,
  MatchedTest,
  GroupedTest,
  ReplacedTest,
  TaxedTest,
  UnannotatedParamTest,
  UnannotatedMultiTest,
  UnannotatedMixedTest,
  UnannotatedProjectTest,
  DeepAnnotatedTest,
  AnyReturnBrandTest,
  DirectInferTest,
  AnyReturnInferTest,
  SystemVarArgTest,
  SystemVarUnannotatedTest,
};
