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
  /** Max recursion depth reached while walking the type tree. */
  depth: number;
  /** Whether the walker bottomed out at the depth or count cap. */
  walkLimited: boolean;
  /** Number of distinct ts.Type instances visited while walking. */
  uniqueTypes: number;
  /** Named types that appear in the inferred result, sorted by count. */
  referencedNames: { name: string; count: number }[];
  /**
   * For value declarations whose initializer is a chain of calls / new
   * expressions, the per-step trace. Each step records the call site and the
   * *declared* return type of the invoked signature (the un-evaluated source
   * text, e.g. `Pipeline<StartingDocs, ResolveSetOutput<S, PreviousStageDocs>, Mode, UsedStages | "$set">`)
   * alongside the *resolved* type at that site. The resolved form is what TS
   * actually computed; the declared form shows what type expression produced
   * it — the only way to see beyond the checker's eager reduction.
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
