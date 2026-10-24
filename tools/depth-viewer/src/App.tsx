import { useCallback, useEffect, useRef, useState } from "react";

import { DetailsPanel } from "./components/DetailsPanel";
import { RebuildButton } from "./components/RebuildButton";
import { Sidebar } from "./components/Sidebar";
import { DatasetMissingError, fmtCount, loadDataset } from "./data";
import { useRebuild } from "./rebuild";
import type { Dataset, SymbolStats } from "./types";

export function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolStats | null>(
    null
  );

  // Current selection, mirrored into a ref so the stable `refetch` can re-bind
  // it against a freshly loaded dataset without going stale.
  const selRef = useRef<{ file: string | null; name: string | null }>({
    file: null,
    name: null,
  });
  // Coalesce overlapping refetches (a button build fires both an SSE
  // completion and a data-file-changed event) into a single trailing run.
  const refetching = useRef({ running: false, pending: false });

  const refetch = useCallback(async (isReload: boolean): Promise<void> => {
    if (refetching.current.running) {
      refetching.current.pending = true;
      return;
    }
    refetching.current.running = true;
    if (isReload) setReloading(true);
    try {
      const next = await loadDataset();
      setData(next);
      setMissing(false);
      setError(null);
      // Preserve the user's selection across the swap by (file, name).
      const { file, name } = selRef.current;
      if (file && name) {
        const rebound = next.index[file]?.find((s) => s.name === name) ?? null;
        setSelectedSymbol(rebound);
        if (!rebound) setSelectedFile(null);
      }
    } catch (e: unknown) {
      if (e instanceof DatasetMissingError) {
        setMissing(true);
        setData(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isReload) setReloading(false);
      refetching.current.running = false;
      if (refetching.current.pending) {
        refetching.current.pending = false;
        void refetch(isReload);
      }
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void refetch(false);
  }, [refetch]);

  // A terminal `depth-view:build` (or any other write to the data dir) pushes a
  // custom HMR event; refresh in place rather than reloading the page.
  useEffect(() => {
    if (!import.meta.hot) return;
    const hot = import.meta.hot;
    const handler = () => void refetch(true);
    hot.on("depth:data-changed", handler);
    return () => hot.off("depth:data-changed", handler);
  }, [refetch]);

  const { snapshot, busy, rejected, trigger } = useRebuild(
    useCallback(() => void refetch(true), [refetch])
  );

  const select = (file: string, symbol: SymbolStats) => {
    setSelectedFile(file);
    setSelectedSymbol(symbol);
    selRef.current = { file, name: symbol.name };
  };

  const showRebuild = import.meta.env.DEV;

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
        : <span className="meta">{missing ? "" : "loading..."}</span>}
        {showRebuild && data ?
          <RebuildButton
            snapshot={snapshot}
            busy={busy}
            rejected={rejected}
            reloading={reloading}
            onTrigger={trigger}
            variant="header"
          />
        : null}
      </header>

      <aside className="sidebar">
        {data ?
          <Sidebar
            data={data}
            selectedFile={selectedFile}
            selectedSymbol={selectedSymbol}
            onSelect={select}
          />
        : missing ?
          <div className="placeholder">No dataset loaded.</div>
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
        : missing ?
          <div className="placeholder empty-state">
            <h2>No dataset yet</h2>
            <p>
              The viewer renders a dataset produced from a cold{" "}
              <code>tsc --generateTrace</code> of this repo. Build it to get
              started.
            </p>
            {showRebuild ?
              <RebuildButton
                snapshot={snapshot}
                busy={busy}
                rejected={rejected}
                reloading={reloading}
                onTrigger={trigger}
                variant="empty"
              />
            : <p className="mono">Run: bun run depth-view:build</p>}
          </div>
        : error ?
          <div className="placeholder error">{error}</div>
        : data ?
          <div className="placeholder">Pick a file and a symbol.</div>
        : <div className="placeholder">Loading...</div>}
      </main>
    </div>
  );
}
