export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>depth-viewer</h1>
        <span className="meta">PipeSafe TS instantiation hotspots</span>
      </header>
      <aside className="sidebar">
        <div className="placeholder">
          Run <code>bun run depth-view:build</code> to generate trace data, then
          reload.
        </div>
      </aside>
      <main className="main">
        <div className="placeholder">No symbol selected.</div>
      </main>
    </div>
  );
}
