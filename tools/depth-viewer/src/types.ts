export interface AggregatedType {
  id: number;
  name: string;
  file?: string;
  line?: number;
  endLine?: number;
  totalUs: number;
  callCount: number;
  parent?: number;
}

export type SymbolKind =
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "function";

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
}

export interface ExpressionCost {
  pos: number;
  end: number;
  totalUs: number;
  callCount: number;
}

export interface Meta {
  project: string;
  generatedAt: string;
  totalEvents: number;
  totalCheckTypes: number;
  totalUs: number;
  uniqueTypes: number;
  depthLimitHits: number;
  relatedToLimitHits: number;
  peakInstantiationCount: number;
  ceilings: {
    instantiationDepth: number;
    instantiationCount: number;
    tailCount: number;
  };
}

export interface Dataset {
  meta: Meta;
  types: AggregatedType[];
  index: Record<string, SymbolEntry[]>;
  expressions: Record<string, ExpressionCost[]>;
}
