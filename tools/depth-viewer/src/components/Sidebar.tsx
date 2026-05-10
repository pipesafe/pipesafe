import { useMemo, useState } from "react";

import type { Dataset, SymbolEntry } from "../types";

interface Props {
  data: Dataset;
  selectedFile: string | null;
  selectedSymbol: SymbolEntry | null;
  onSelect(file: string, symbol: SymbolEntry): void;
}

export function Sidebar({
  data,
  selectedFile,
  selectedSymbol,
  onSelect,
}: Props) {
  const [fileQuery, setFileQuery] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");

  const files = useMemo(() => {
    const all = Object.keys(data.index).sort();
    if (!fileQuery) return all;
    const q = fileQuery.toLowerCase();
    return all.filter((f) => f.toLowerCase().includes(q));
  }, [data.index, fileQuery]);

  const symbols = useMemo(() => {
    if (!selectedFile) return [];
    const all = data.index[selectedFile] ?? [];
    if (!symbolQuery) return all;
    const q = symbolQuery.toLowerCase();
    return all.filter((s) => s.name.toLowerCase().includes(q));
  }, [data.index, selectedFile, symbolQuery]);

  return (
    <div className="picker">
      <section className="picker-section">
        <label className="picker-label">file</label>
        <input
          className="picker-search"
          placeholder="filter files..."
          value={fileQuery}
          onChange={(e) => setFileQuery(e.target.value)}
        />
        <div className="picker-list">
          {files.map((f) => (
            <button
              key={f}
              className={`picker-row ${f === selectedFile ? "is-active" : ""}`}
              onClick={() => {
                const first = data.index[f]?.[0];
                if (first) onSelect(f, first);
              }}
              title={f}
            >
              <span className="mono">{f.replace(/^packages\//, "")}</span>
            </button>
          ))}
          {files.length === 0 && (
            <div className="picker-empty">no files match</div>
          )}
        </div>
      </section>

      <section className="picker-section">
        <label className="picker-label">
          symbol{" "}
          {selectedFile && <span className="muted">in selected file</span>}
        </label>
        <input
          className="picker-search"
          placeholder={selectedFile ? "filter symbols..." : "pick a file first"}
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(e.target.value)}
          disabled={!selectedFile}
        />
        <div className="picker-list">
          {selectedFile &&
            symbols.map((s) => (
              <button
                key={`${s.name}:${s.startLine}`}
                className={`picker-row ${
                  (
                    selectedSymbol?.name === s.name &&
                    selectedSymbol?.startLine === s.startLine
                  ) ?
                    "is-active"
                  : ""
                }`}
                onClick={() => onSelect(selectedFile, s)}
              >
                <span className={`tag tag-${s.kind}`}>{s.kind}</span>
                <span className="mono">{s.name}</span>
                <span className="muted">:{s.startLine}</span>
              </button>
            ))}
          {selectedFile && symbols.length === 0 && (
            <div className="picker-empty">no symbols match</div>
          )}
        </div>
      </section>
    </div>
  );
}
