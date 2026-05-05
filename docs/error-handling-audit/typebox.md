# TypeBox Error-DX Audit

## Overview
TypeBox (sinclairzx81/typebox) is a JSON Schema type system with phantom typing. Unlike ArkType's string DSL, TypeBox uses `Type.Object({...})` factories that return schema objects with `~kind` branded properties. Error-DX in TypeBox operates at two levels: **schema construction** (compile-time type inference) and **static type extraction** (via `Static<T>`). TypeBox's error techniques are more implicit than explicit—errors surface through constraint narrowing and property validation rather than dedicated error types.

**Codebase scope:** ~10,730 LoC in `src/type/`. Tests, docs, dist, and build files excluded.

---

## Findings Summary

| Technique | Category | Count | Evidence |
|-----------|----------|-------|----------|
| **Property-Level Constraint Branching** | T6 | 4 files | Properties narrowed by `extends` conditionals on `TOptional<TSchema>`, `TReadonly<TSchema>` |
| **Phantom Direction Encoding** | T4 | 2 files | `StaticDirection` ('Encode' \| 'Decode') determines return type via `TCodec<...>` constraint |
| **Modifier Stack Tracking** | T11 | 3 files | `~optional`, `~readonly`, `~refine`, `~codec` symbols track type-level state |
| **Recursive Schema Validation** | T6 | 1 file | `XStaticSchema` chains keyword validators; invalid branches return `never` |
| **Static Type Extraction via Conditional** | T1 | 1 file | `StaticType<Stack, Direction, Context, This, Type>` discriminates on `TSchema` subtypes; missing types fall through to `XStatic` |
| **Compile-Time Refinement** | T4 | 1 file | `TRefine<Type>` embeds runtime check metadata; validation happens at property-application level |

---

## Technique Details

### T6: Constraint-Side Validation via Property Narrowing

**Location:** `/tmp/audit-libs/typebox/src/type/types/_optional.ts`, `_readonly.ts`, `properties.ts`

**Pattern:**
```typescript
// _optional.ts:39-40
export type TOptionalRemove<Type extends TSchema,
  Result extends TSchema = Type extends TOptional<infer Type extends TSchema> ? Type : Type
> = Result

// properties.ts:42-45 (Property composition validation)
type ReadonlyOptionalKeys<Properties extends TProperties, 
  Result extends PropertyKey = { [Key in keyof Properties]: 
    Properties[Key] extends TReadonly<TSchema> ? 
      (Properties[Key] extends TOptional<Properties[Key]> ? Key : never) 
    : never 
  }[keyof Properties]
> = Result
```

**Observable Effect:** When a property doesn't satisfy modifier constraints (e.g., a property cannot be both readonly and optional in certain contexts), the `never` branch silently filters it out. No explicit error message; the type narrowing IS the validation. At runtime, guards like `IsOptional()` and `IsReadonly()` perform the equivalent checks.

**Classification:** T6. Constraint validation happens in generic `extends` clauses; failure returns `never` rather than `ErrorType`.

---

### T4: Conditional Degradation via Direction and Codec Constraints

**Location:** `/tmp/audit-libs/typebox/src/type/types/_codec.ts` (lines 41–45)

**Pattern:**
```typescript
export type StaticCodec<Stack extends string[], Direction extends StaticDirection, 
  Context extends TProperties, This extends TProperties, Type extends TSchema, Decoded extends unknown
> = (
  Direction extends 'Decode' 
    ? Decoded
    : StaticType<Stack, Direction, Context, This, Omit<Type, '~codec'>> // prevent recurrence
)
```

**Observable Effect:** If a codec is used with invalid direction (`Direction` is neither 'Encode' nor 'Decode'), the conditional branch not taken will defer to `StaticType<...>`, which may fail to match any concrete type, returning `unknown`. This is a soft error—the type is still valid but loses precision. Hovers will show `unknown` instead of the intended type.

**Classification:** T4. Conditional narrowing (not explicit `ErrorType`, but degradation to `unknown` or unresolved generic).

---

### T11: Symbol-Based Tracking via Phantom Keys

**Location:** `/tmp/audit-libs/typebox/src/type/types/base.ts`, `_optional.ts`, `_readonly.ts`, `_refine.ts`

**Pattern:**
```typescript
// _optional.ts:61-62
export type TOptional<Type extends TSchema = TSchema> = (
  Type & { '~optional': true }
)

// _refine.ts:53-54
export type TRefine<Type extends TSchema = TSchema> = (
  Type & { '~refine': TRefinement<Type>[] }
)

// base.ts:83-84
public readonly '~kind': 'Base'
public readonly '~guard': XGuardInterface<Value>
```

**Observable Effect:** Properties like `~optional`, `~readonly`, `~refine`, `~codec`, and `~kind` are prefixed with `~` (tilde) to signal they are internal compile-time metadata. These do not affect JSON Schema serialization (they are stripped at runtime) but allow type-level discrimination. Guard functions like `IsOptional()`, `IsReadonly()` check these keys at runtime; the type system uses them for branching.

**Classification:** T11. Branded symbols for tracking type-level state without runtime footprint.

---

### T6: Recursive Schema Keyword Validation

**Location:** `/tmp/audit-libs/typebox/src/schema/static/schema.ts` (lines 66–120)

**Pattern:**
```typescript
type XFromKeywords<Stack extends string[], Root extends XSchema, Schema extends XSchema,
  Result extends unknown[] = [
    Schema extends XAdditionalProperties<infer Type extends XSchema> ? XStaticAdditionalProperties<Stack, Root, Type> : unknown,
    Schema extends XAllOf<infer Types extends XSchema[]> ? XStaticAllOf<Stack, Root, Types> : unknown,
    Schema extends XAnyOf<infer Types extends XSchema[]> ? XStaticAnyOf<Stack, Root, Types> : unknown,
    Schema extends XConst<infer Value extends unknown> ? XStaticConst<Value> : unknown,
    Schema extends XEnum<infer Values extends unknown[]> ? XStaticEnum<Values> : unknown,
    // ... more keyword matchers
  ]
> = Result

export type XStaticSchema<Stack extends string[], Root extends XSchema, Schema extends XSchema,
  Result extends unknown = Schema extends boolean 
    ? XStaticBoolean<Schema> 
    : XStaticObject<Stack, Root, Schema>
> = Result
```

**Observable Effect:** When a schema is validated, `XStaticSchema` chains all keyword validators. If the schema contains unknown or malformed keywords, they are silently ignored (mapped to `unknown` in the result array, then intersected). Only recognized keywords contribute to the final type. This is defensive rather than error-reporting—malformed schemas degrade gracefully to `unknown` instead of failing.

**Classification:** T6. Constraint-side validation with silent degradation to `unknown` for unmatched branches.

---

### T1 (Minor): Static Type Extraction with Fallback

**Location:** `/tmp/audit-libs/typebox/src/type/types/static.ts` (lines 81–114)

**Pattern:**
```typescript
export type StaticType<Stack extends string[], Direction extends StaticDirection, 
  Context extends TProperties, This extends TProperties, Type extends TSchema
> = (
  Type extends TCodec<infer Type extends TSchema, infer Decoded extends unknown> 
    ? StaticCodec<Stack, Direction, Context, This, Type, Decoded> :
  Type extends TAny ? StaticAny :
  Type extends TArray<infer Items extends TSchema> ? StaticArray<...> :
  // ... 10 more branches
  XStatic<Type>  // Fallback for external schemas
)
```

**Observable Effect:** If a type doesn't match any of the 15+ known TypeBox types, it falls through to `XStatic<Type>` (an escape hatch for JSON Schema). This is not a hard error; the fallback allows extension without validation. If `Type` is truly unknown, `XStatic` returns `unknown`.

**Classification:** T1 (weak). No explicit error message; fallback to `unknown` is the "error" signal.

---

### T4: Refinement Embedding (Compile-Time Metadata)

**Location:** `/tmp/audit-libs/typebox/src/type/types/_refine.ts` (lines 40–81)

**Pattern:**
```typescript
export type TRefineCheckCallback<Type extends TSchema = TSchema> = (value: Static<Type>) => boolean
export type TRefineErrorCallback<Type extends TSchema = TSchema> = (value: Static<Type>) => string

export interface TRefinement<Type extends TSchema = TSchema> {
  check: TRefineCheckCallback<Type>
  error: TRefineErrorCallback<Type>
}

export function Refine<Type extends TSchema>(
  type: Type, 
  check: TRefineCheckCallback<Type>, 
  error: TRefineErrorCallback<Type>
): TRefineAdd<Type>
```

**Observable Effect:** Refinements are attached to types as metadata (`~refine` array). At the type level, `TRefineCheckCallback<Type>` uses `Static<Type>` to ensure the callback receives the inferred type, providing compile-time safety. Invalid refinements (where the callback signature doesn't match `Static<Type>`) trigger type errors. At runtime, errors are descriptive strings; at compile time, the type is narrowed to the base type with the refinement embedded.

**Classification:** T4 (Conditional Degradation). The refined type is either valid (with `~refine` marker) or fails to compile if the callback signature is wrong.

---

## Applicability to Pipesafe (≤ 200 words)

TypeBox's core techniques are **implicit and structural** rather than explicit error signaling:

1. **Property Constraint Branching (T6):** Pipesafe's deeply nested aggregation pipeline stages can use modifier composition (readonly, optional) and phantom keys (`~` prefixed) to track validation state at each composition level. E.g., a stage that accepts only immutable schemas can use `Type extends TImmutable<infer T> ? ... : never`.

2. **Direction Encoding (T4):** Pipeline stages often have **encode/decode semantics** (input → transformed output). TypeBox's `StaticDirection` pattern can model pipeline accumulation: encode stages consume raw document input; decode stages emit final results. Constraint narrowing enforces direction consistency.

3. **Symbol Tracking (T11):** Use `~` branded keys to tag schemas with pipeline metadata (e.g., `~stage_id`, `~constraint_level`) without serialization overhead. Guards check these at function boundaries.

4. **Recursive Keyword Validation (T6):** Aggregation operators (e.g., `$group`, `$lookup`) are schema keywords. TypeBox's chaining pattern validates nested operator specs in parallel, silently dropping invalid branches—useful for permissive error recovery in pipeline construction.

**Limitation:** TypeBox lacks explicit error messages at the type level. Errors are silent type degradation (`unknown` / `never`). For Pipesafe's UX, consider pairing these structural techniques with **explicit error-return types (T1)** to surface helpful IDE hovers.

---

## References

- **File:** `/tmp/audit-libs/typebox/src/type/types/static.ts` — `StaticType` discriminator
- **File:** `/tmp/audit-libs/typebox/src/type/types/_codec.ts` — Direction-based conditional
- **File:** `/tmp/audit-libs/typebox/src/type/types/_optional.ts`, `_readonly.ts` — Modifier tracking
- **File:** `/tmp/audit-libs/typebox/src/type/types/_refine.ts` — Refinement callbacks
- **File:** `/tmp/audit-libs/typebox/src/schema/static/schema.ts` — Schema validation chain

