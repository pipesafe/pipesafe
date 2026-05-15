import { useEffect, useState } from "react";

import { DetailsPanel } from "./components/DetailsPanel";
import { Sidebar } from "./components/Sidebar";
import { fmtCount, loadDataset } from "./data";
import type { Dataset, SymbolStats } from "./types";

export function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolStats | null>(
    null
  );

  useEffect(() => {
    loadDataset()
      .then(setData)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>depth-viewer</h1>
        {data ?
          <span className="meta mono">
            {data.meta.project} · {fmtCount(data.meta.totalSymbols)} symbols ·{" "}
            {fmtCount(data.meta.ownedEntries)} owned registry entries (of{" "}
            {fmtCount(data.meta.totalEntries)} total)
          </span>
        : <span className="meta">loading...</span>}
      </header>

      <aside className="sidebar">
        {data ?
          <Sidebar
            data={data}
            selectedFile={selectedFile}
            selectedSymbol={selectedSymbol}
            onSelect={(file, symbol) => {
              setSelectedFile(file);
              setSelectedSymbol(symbol);
            }}
          />
        : error ?
          <div className="placeholder error">{error}</div>
        : <div className="placeholder">loading data...</div>}
      </aside>

      <main className="main">
        {data && selectedFile && selectedSymbol ?
          <DetailsPanel
            data={data}
            file={selectedFile}
            symbol={selectedSymbol}
          />
        : <div className="placeholder">
            {data ?
              "Pick a file and a symbol from the sidebar."
            : error ?
              "No data loaded."
            : "Loading..."}
          </div>
        }
      </main>
    </div>
  );
}
