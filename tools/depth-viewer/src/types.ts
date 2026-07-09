// Data model for the depth-viewer.
// -----------------------------------------------------------------------
// Sourced from tsc's `--generateTrace` types.json (full, non-sampled type
// registry) + the TypeScript Compiler API for source AST. Wall-clock time
// is intentionally absent: trace events are sampling-based at 10ms and
// machine-dependent. Counts come straight from the registry.

export type SymbolKind =
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "function"
  | "class";

export interface SymbolReference {
  /** Head name of the TypeReference (e.g. `Paths` in `Paths<User>`). */
  name: string;
  /** Where the reference appears, 1-indexed. */
  line: number;
}

export interface InferredTypeInfo {
  /** `typeToString(NoTruncation)` of the inferred type. */
  display: string;
  /** True if `display` was clipped to a length cap. */
  truncated: boolean;
  /**
   * Max instantiation depth the checker reached anywhere in this declaration,
   * read from the patched tsc trace (the peak `instantiationDepth`) — NOT
   * walked from the resolved type. `undefined` when no Call/New expression in
   * the declaration produced a trace record (e.g. a plain object-literal const).
   */
  depth?: number;
  /** True when {@link depth} hit the 100 instantiation-depth ceiling (TS2589). */
  hitDepthLimit: boolean;
  /**
   * Max tail-recursive conditional-type elaboration count across the
   * declaration, from the patched tsc trace — a separate TS2589 trigger
   * (ceiling 1000) that fires with low instantiation depth. `undefined` when no
   * Call/New step produced a trace record.
   */
  tail?: number;
  /** True when {@link tail} hit the 1000 tail-recursion ceiling (TS2589). */
  hitTailLimit: boolean;
  /**
   * Max per-unit instantiationCount across the declaration, from the trace —
   * the third TS2589 trigger (ceiling 5,000,000), the one that collapses the
   * whole type to `any`. `undefined` when no Call/New step produced a record.
   */
  count?: number;
  /** True when {@link count} hit the 5,000,000 instantiation-count ceiling (TS2589). */
  hitCountLimit: boolean;
  /**
   * True when the checker returned an error type for this declaration (usually
   * the TS2589 "excessively deep" bail). The resolved `display`/`uniqueTypes`
   * are then not a real measurement of the intended type.
   */
  errored: boolean;
  /** Whether the structural walk (used only for {@link uniqueTypes}) hit its cap. */
  walkLimited: boolean;
  /** Number of distinct ts.Type instances visited while walking (coverage only). */
  uniqueTypes: number;
  /** Named types that appear in the inferred result, sorted by count. */
  referencedNames: { name: string; count: number }[];
  /**
   * For value declarations whose initializer is a chain of calls / new
   * expressions, the per-step trace. Each step records the call site, the
   * *declared* return type of the invoked signature (the un-evaluated source
   * text, e.g. `Pipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>, Mode, UsedStages | "$set">`),
   * the *resolved* type at that site, and the per-step depth/count the checker
   * actually spent (from the patched tsc trace).
   */
  chain?: ChainStep[];
}

export interface ChainStep {
  /** Label for the call site, e.g. `new Pipeline<TestDoc>()` or `.set({...})`. */
  label: string;
  /** Member name being invoked, if known (`set`, `match`, etc.). */
  member?: string;
  /** Declared return-type annotation text — preserves names like `ResolveSetOutput<…>`. */
  declaredReturnType?: string;
  /** Source location of the method declaration whose signature was used. */
  declaredAt?: { file: string; line: number };
  /** Resolved type at this call site (post-evaluation). */
  resolvedType: string;
  /** 1-indexed line of this call expression inside the source file. */
  callLine: number;
  /**
   * Peak instantiation depth the checker reached computing this step, from the
   * patched tsc trace (cumulative over the step's subtree, so it climbs along
   * the chain and saturates at 100 on TS2589). Absent if no trace record
   * matched this call.
   */
  maxDepth?: number;
  /**
   * Depth this step's own signature/return resolution added, above the ambient
   * entry depth (excludes all nested expression children). A subtle marginal,
   * surfaced in the tooltip only.
   */
  ownDepth?: number;
  /**
   * Peak tail-recursive conditional-type elaboration count for this step (a
   * separate TS2589 trigger, ceiling 1000). 0 if no tail recursion ran.
   */
  maxTail?: number;
  /**
   * Instantiations this step performed (marginal, not inherited by later steps).
   * The third TS2589 trigger fires when one step crosses 5,000,000, collapsing
   * the whole type to `any`; reads ~0 on steps whose type is already `any`.
   */
  maxCount?: number;
  /** True when {@link maxDepth} reached the 100 ceiling. */
  hitDepthLimit?: boolean;
  /** True when {@link maxTail} reached the 1000 ceiling. */
  hitTailLimit?: boolean;
  /** True when {@link maxCount} reached the 5,000,000 ceiling. */
  hitCountLimit?: boolean;
  /**
   * True when this step had no trace record and its depth/tail were derived
   * from the steps nested inside it (the outermost step short-circuits once an
   * inner step trips TS2589). The depth is exact; `ownDepth`/`instantiations`
   * are just not measured for it.
   */
  depthInferred?: boolean;
}

export interface SymbolStats {
  // identification
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  /** Named types this symbol's source range textually references. */
  references: SymbolReference[];

  // computed from types.json
  /**
   * Number of registry entries (instantiations, conditional resolutions,
   * mapped expansions, anonymous Object/Union/Intersection nodes…) whose
   * `firstDeclaration` overlaps this symbol's range. The honest measure of
   * "how much work the checker did here".
   */
  entriesCreated: number;
  /** Breakdown of entriesCreated by TS flag (Object, Conditional, …). */
  entriesByKind: Record<string, number>;
  /**
   * For types/interfaces: the number of TypeReference nodes across the
   * whole project whose head name matches this symbol's name. For other
   * kinds, 0.
   */
  callSites: number;
  /**
   * Inferred type analysis for value declarations (const/let/var). Reflects
   * what the checker actually produces — distinct from `references` which
   * is the *declared* (annotated) type's text. Absent for types/interfaces.
   */
  inferred?: InferredTypeInfo;
}

export interface Meta {
  project: string;
  generatedAt: string;
  /** Total raw entries in types.json (the complete registry). */
  totalEntries: number;
  /** Entries whose firstDeclaration lives in a project source file. */
  ownedEntries: number;
  /** Per-file count of declared symbols. */
  totalSymbols: number;
  ceilings: {
    instantiationDepth: number;
    instantiationCount: number;
    tailCount: number;
  };
}

export interface Dataset {
  meta: Meta;
  /** File → ordered SymbolStats. */
  index: Record<string, SymbolStats[]>;
  /** File → full source text, for the snippet renderer. */
  sources: Record<string, string>;
}
