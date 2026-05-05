# TanStack Router Type-Level Error DX Audit

**Library:** TanStack Router v1.x  
**Scope:** `packages/router-core/src/` and `packages/react-router/src/`  
**Audit Date:** 2026-05-05  
**Focus:** Typed route paths, params, and search validation

---

## Search Pattern Results

| Pattern                                               | Count | Files                                         |
| ----------------------------------------------------- | ----- | --------------------------------------------- |
| Template literal parsing (`extends \``)               | 28    | link.ts, routeInfo.ts, route.ts, Matches.ts   |
| Never-based validators (`extends never`, `? never :`) | 26    | link.ts (path construction)                   |
| Deprecation markers (@deprecated, @internal)          | 49    | route.ts, link.ts, Matches.ts                 |
| Hover flatteners (Expand type)                        | 28    | route.ts, useParams.ts, useSearch.ts, link.ts |
| ConstrainLiteral / Constrain validation               | 12    | link.ts, typePrimitives.ts                    |
| Serialization errors (SerializationError<>)           | 5     | transformer.ts (SSR serializer)               |

---

## Key Findings

### T1: Typed Error Returns (SerializationError<TMessage>)

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/ssr/serializer/transformer.ts:148–150`

TanStack Router uses a branded error interface for SSR serialization validation:

```typescript
export interface SerializationError<in out TMessage extends string> {
  [SERIALIZATION_ERROR]: TMessage
}

export type ValidateSerializable<T, TSerializable> =
  T extends TSerializable ? T
  : T extends (...args: Array<any>) => any
    ? SerializationError<'Function may not be serializable'>
    : T extends RegisteredReadableStream
      ? SerializationError<'JSX is not be serializable'>
      : // ... deeper checks
```

**Observable Effect:** When a user defines a loader returning a non-serializable type (e.g., a function), TypeScript returns `SerializationError<'Function may not be serializable'>` instead of the valid type. IDE hovers show this error directly. The symbol `SERIALIZATION_ERROR` is a unique const symbol used for branding.

**Classification:** **T1 (Typed Error Returns)** — Returns error type itself as the invalid result; unique symbol `SERIALIZATION_ERROR` prevents collision with user types.

**Relevance to Pipesafe:** Direct parallel to `fieldReference.ts` where invalid path references could be branded and returned as error types instead of valid field types.

---

### T2 & T8: Template-Literal Path Parsing with State Machine

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/link.ts:49–124`

TanStack Router implements a recursive template-literal parser for extracting dynamic route params from path strings like `"/users/{$userId}/posts/{$postId}"`:

```typescript
export type ParsePathParamsBoundaryStart<T extends string> =
  T extends `${infer TLeft}{-${infer TRight}`
    ? ParsePathParamsResult<...>
    : T extends `${infer TLeft}{${infer TRight}`
      ? ParsePathParamsResult<...>
      : never

export type ParsePathParamsSymbol<T extends string> =
  T extends `${string}$${infer TRight}`
    ? TRight extends `${string}/${string}`
      ? TRight extends `${infer TParam}/${infer TRest}`
        ? TParam extends ''
          ? ParsePathParamsResult<...>
          : ParsePathParamsResult<TParam | ..., ...>
        : never
      : TRight extends ''
        ? ParsePathParamsResult<never, '_splat', never>
        : ParsePathParamsResult<TRight, never, never>
    : never

export type ParsePathParams<T extends string> =
  T extends `${string}[${string}` ? ParsePathParamsEscapeStart<T>
  : T extends `${string}]${string}` ? ParsePathParamsEscapeEnd<T>
  : T extends `${string}}${string}` ? ParsePathParamsBoundaryEnd<T>
  : T extends `${string}{${string}` ? ParsePathParamsBoundaryStart<T>
  : T extends `${string}$${string}` ? ParsePathParamsSymbol<T>
  : never
```

**Observable Effect:** IDE autocomplete narrows valid `to` paths based on the `from` path and required params. If user writes `<Link to="/users/123" />` but the route requires `{$userId}`, TypeScript fails at the `to` property with an "is not assignable" error showing the missing param.

**Classification:** **T2 + T8 (Template Literals + String DSL Parsing)** — Recursive template-literal state machine with no runtime overhead; entire path validation happens at compile time.

**Relevance to Pipesafe:** Exact analogue to MongoDB aggregation pipeline stage syntax like `$match`, `$group`, `$set`. Field references in `fieldReference.ts` could use similar recursive parsing for detecting invalid `$field.nested.path` expressions.

---

### T4: Conditional Return-Type Degradation (ConstrainLiteral)

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/link.ts:616–631`

TanStack Router uses `ConstrainLiteral` to validate path strings without stripping the literal type:

```typescript
export type ConstrainLiteral<T, TConstraint, TDefault = TConstraint> =
  | (T & TConstraint)
  | TDefault;

export type ToPathOption<
  TRouter extends AnyRouter = AnyRouter,
  TFrom extends string = string,
  TTo extends string | undefined = string,
> = ConstrainLiteral<
  TTo,
  RelativeToPathAutoComplete<
    TRouter,
    NoInfer<TFrom> extends string ? NoInfer<TFrom> : "",
    NoInfer<TTo> & string
  >
>;

export type FromPathOption<TRouter extends AnyRouter, TFrom> = ConstrainLiteral<
  TFrom,
  RoutePaths<TRouter["routeTree"]>
>;
```

**Observable Effect:** When user passes an invalid `to` path, the constraint check fails and IDE shows "Type 'unknown-path' is not assignable to 'valid-path1' | 'valid-path2'". If constraint passes, the narrowed literal type is preserved for downstream inference.

**Classification:** **T4 (Conditional Degradation)** — Intersection constraint that either narrows or rejects, preserving literal types on success.

**Relevance to Pipesafe:** Could validate `$field` path strings against known field definitions; invalid paths would fail the constraint and show all valid options.

---

### T5: Overload Ladders with Inference Recovery

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/link.ts:289–420`

TanStack Router uses complex overloaded function signatures with phantom type parameters to route different `to` / `from` combinations:

```typescript
export type MakeToRequired<
  TRouter extends AnyRouter,
  TFrom extends string,
  TTo extends string | undefined,
> =
  string extends TFrom ?
    string extends TTo ? OptionalToOptions<TRouter, TFrom, TTo>
    : TTo & CatchAllPaths<TRouter> extends never ?
      RequiredToOptions<TRouter, TFrom, TTo>
    : OptionalToOptions<TRouter, TFrom, TTo>
  : OptionalToOptions<TRouter, TFrom, TTo>;

export type ToSubOptionsProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends RoutePaths<TRouter["routeTree"]> | string = string,
  TTo extends string | undefined = ".",
> = MakeToRequired<TRouter, TFrom, TTo> & {
  hash?: true | Updater<string>;
  state?: true | NonNullableUpdater<ParsedHistoryState, HistoryState>;
  from?: FromPathOption<TRouter, TFrom> & {};
  unsafeRelative?: "path";
};
```

**Observable Effect:** IDE shows only required properties when navigating to a route with required params, and optional properties when all params are optional or relative navigation uses catch-all patterns. The `& {}` intersection forces proper property-key narrowing without expanding unions prematurely.

**Classification:** **T5 (Overload Ladders)** — Uses conditional resolution to determine which param properties are required vs. optional based on resolved path.

**Relevance to Pipesafe:** Could determine which aggregation pipeline fields are required vs. optional based on the stage type and context.

---

### T6: Constraint-Side Validation (Never-Based Validators)

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/link.ts:128–172`

TanStack Router uses `extends never` patterns extensively to validate path construction:

```typescript
export type RemoveTrailingSlashes<T> =
  T & `${string}/` extends never ? T
  : T extends `${infer R}/` ? R
  : T;

export type AddLeadingSlash<T> =
  T & `/${string}` extends never ? `/${T & string}` : T;

export type ResolveCurrentPath<TFrom extends string, TTo extends string> =
  TTo extends "." ? TFrom
  : TTo extends "./" ? AddTrailingSlash<TFrom>
  : TTo & `./${string}` extends never ? never
  : TTo extends `./${infer TRest}` ? AddLeadingSlash<JoinPath<TFrom, TRest>>
  : never;
```

**Observable Effect:** When a path-resolution type reaches a `? never` branch, the entire resolved path becomes `never`. Downstream consumers see an unsatisfiable constraint ("expected never but got string") which signals a logical path inconsistency.

**Classification:** **T6 (Constraint Validation)** — Never-based short-circuits that halt type expansion on invalid paths.

**Relevance to Pipesafe:** Analogous to validating pipeline stage order, e.g., `$lookup` cannot follow `$group` without an `$unwind`.

---

### T10: Hover-Flattening via `Expand<T>`

**Location:** `/tmp/audit-libs/tanstack-router/packages/router-core/src/utils.ts:28–34` and `/tmp/audit-libs/tanstack-router/packages/router-core/src/route.ts` (28 usages)

TanStack Router uses the `Expand` utility type to force intersection and union normalization for IDE readability:

```typescript
export type Expand<T> =
  T extends object ?
    T extends infer O ?
      O extends Function ?
        O
      : { [K in keyof O]: O[K] }
    : never
  : T;
```

Used extensively in param and search-schema inference:

```typescript
rawParams: Expand<ResolveParams<TPath>>,
search: Expand<ResolveFullSearchSchema<TParentRoute, TSearchValidator>>
params: Expand<ResolveAllParamsFromParent<TParentRoute, TParams>>
context: Expand<RouteContextParameter<TParentRoute, TRouterContext>>
```

**Observable Effect:** Hovers show flattened object types like `{ userId: string; postId: string }` instead of nested intersections or conditional spreads. This dramatically improves readability for complex param unions.

**Classification:** **T10 (Hover-Flattening)** — Utility type that forces intersection/union normalization for display.

**Relevance to Pipesafe:** Critical for match.ts and group.ts where accumulated field types can become deeply nested. `Expand<AccumulatedFields>` would clarify inferred field schemas in IDE tooltips.

---

### T12: JSDoc Deprecation Markers

**Location:** Multiple files (49 total occurrences)

TanStack Router extensively uses `@deprecated`, `@internal`, and implicit `@hidden` markers:

```typescript
/** @deprecated Use params.parse instead */
parseParams?: ParseParamsFn<TPath, TParams> &
  ValidateParsedParams<TPath, TParams>

/** @deprecated Use params.stringify instead */
stringifyParams?: StringifyParamsFn<TPath, TParams>

/** @internal */
__routeContext?: Record<string, unknown>

/**
 * @deprecated Use `throw redirect({ to: '/somewhere' })` instead
 */
export type OnBeforeRouteUpdate = (...)=> ...
```

**Observable Effect:** IDE shows strikethrough on deprecated properties, suggests alternative APIs in diagnostics, emits warnings in build output. Provides soft migration path for breaking changes.

**Classification:** **T12 (JSDoc Warnings)** — Soft API deprecation using standard JSDoc annotations.

**Relevance to Pipesafe:** Could deprecate legacy pipeline stage patterns (e.g., `{ $group: { _id: null } }`) while suggesting modern alternatives.

---

## Summary Table

| ID  | Technique                   | Evidence                                            | Applicability                                            |
| --- | --------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| T1  | Typed Error Returns         | `SerializationError<TMessage>` in transformer.ts    | High — SSR validator parallel                            |
| T2  | Template-Literal Positional | `ParsePathParams<T>` recursive parser               | Critical — path validation = field path validation       |
| T4  | Conditional Degradation     | `ConstrainLiteral<T, Constraint>`                   | High — route path constraint = field path constraint     |
| T5  | Overload Ladders            | `MakeToRequired<TRouter, TFrom, TTo>` param routing | Medium — stage param routing analogue                    |
| T6  | Constraint Validation       | `extends never` in path resolution                  | High — pipeline stage order validation                   |
| T8  | String DSL Parser           | `ParsePathParams` state machine                     | Critical — direct analogue to pipeline syntax            |
| T10 | Hover-Flattening            | `Expand<T>` (28 usages)                             | Critical — field schema readability in match.ts/group.ts |
| T12 | JSDoc Warnings              | @deprecated on parseParams, stringifyParams, etc.   | Medium — soft API migration                              |

---

## Highest-Impact Techniques for Pipesafe

### 1. **Template-Literal Path Parsing** (T2 + T8)

- **Why:** TanStack's `ParsePathParams<T>` directly mirrors Pipesafe's need to parse `$field.nested.path` strings in `fieldReference.ts`.
- **Implementation:** Recursive conditional that extracts parameter names from path syntax; uses `infer` to capture segments.
- **Error Surface:** Invalid segments produce `never`, making wrong field refs unmatchable.

### 2. **Expand<T> for Inferred Schemas** (T10)

- **Why:** Pipesafe's `match.ts`, `group.ts`, and `set.ts` accumulate complex field types from nested operator chains.
- **Implementation:** Simple mapped-type normalizer that forces intersection expansion.
- **Benefit:** Hovers show `{ _id: string; count: number }` instead of `{ _id: string } & { count: number }`.

### 3. **ConstrainLiteral for Stage Literals** (T4)

- **Why:** Validates that user-supplied stage keys (e.g., `$match`, `$group`) exist without losing literal type.
- **Implementation:** Intersection `T & ValidStages | Default` preserves narrowing.
- **Error Surface:** Invalid stage names fail constraint and suggest valid options in IDE.

### 4. **SerializationError<TMessage>** (T1)

- **Why:** Pipesafe could validate aggregation function bodies (e.g., `$function` stage) are serializable to JSON/BSON.
- **Implementation:** Branded error interface with unique symbol to avoid collision.
- **Benefit:** Compile-time detection of non-serializable code in loaders/handlers.

---

## Conclusion

TanStack Router achieves sophisticated route-typing DX through **recursive template-literal parsing** combined with **conditional param routing** and **hover-flattening utilities**. Its architecture directly parallels Pipesafe's need to validate deeply nested field references and aggregation pipeline stages. Key transferable techniques:

- **ParsePathParams-style recursive parsing** for field path validation
- **Expand<T> normalization** for readable inferred field schemas
- **ConstrainLiteral narrowing** for stage/operator literal validation
- **Never-based short-circuits** for pipeline order constraints

These techniques are low-cost (no runtime impact), IDE-native (hovers show errors immediately), and provide autocomplete-driven error recovery.
