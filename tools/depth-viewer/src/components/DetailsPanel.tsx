import { useMemo } from "react";

import { findSymbolByName, fmtCount } from "../data";
import type { Dataset, SymbolStats } from "../types";

interface Props {
  data: Dataset;
  file: string;
  symbol: SymbolStats;
}

export function DetailsPanel({ data, file, symbol }: Props) {
  const sourceLines = useMemo(() => {
    const src = data.sources[file];
    if (!src) return null;
    const allLines = src.split("\n");
    return allLines.slice(symbol.startLine - 1, symbol.endLine);
  }, [data.sources, file, symbol.startLine, symbol.endLine]);

  const kindRows = useMemo(
    () => Object.entries(symbol.entriesByKind).sort((a, b) => b[1] - a[1]),
    [symbol.entriesByKind]
  );

  // Group references by name + resolved target, with counts.
  const referenceRows = useMemo(() => {
    const tally = new Map<
      string,
      {
        name: string;
        target?: SymbolStats;
        count: number;
      }
    >();
    for (const r of symbol.references) {
      const cur = tally.get(r.name);
      if (cur) {
        cur.count += 1;
      } else {
        const target = findSymbolByName(data.index, r.name);
        tally.set(r.name, {
          name: r.name,
          ...(target && { target }),
          count: 1,
        });
      }
    }
    return Array.from(tally.values()).sort((a, b) => b.count - a.count);
  }, [symbol.references, data.index]);

  return (
    <div className="details">
      <header className="details-header">
        <h2>
          <span className={`tag tag-${symbol.kind}`}>{symbol.kind}</span>
          <span className="mono">{symbol.name}</span>
        </h2>
        <p className="muted mono">
          {file}:{symbol.startLine}
          {symbol.endLine !== symbol.startLine && `-${symbol.endLine}`}
        </p>
        {sourceLines && sourceLines.length > 0 && (
          <pre className="source-snippet">
            <code>
              {sourceLines.map((line, i) => (
                <span key={i} className="source-line">
                  <span className="source-lineno">{symbol.startLine + i}</span>
                  <span className="source-content">{line || " "}</span>
                </span>
              ))}
            </code>
          </pre>
        )}
      </header>

      {symbol.inferred?.chain && symbol.inferred.chain.length > 0 && (
        <section className="details-section">
          <h3>Initializer chain</h3>
          <p className="muted">
            Each step in this declaration's initializer, in execution order. The{" "}
            <em>declared return type</em> column is the source-text annotation
            of the invoked method's signature — so type expressions like{" "}
            <code>ResolveSetOutput&lt;S, …&gt;</code> appear verbatim, before
            TypeScript reduced them to the final shape. The{" "}
            <em>resolved type</em> column is what the checker actually computed
            at this call site.
          </p>
          <div className="chain">
            {symbol.inferred.chain.map((step, i) => (
              <div key={i} className="chain-step">
                <div className="chain-step-header">
                  <span className="mono">{step.label}</span>
                  <span className="muted">
                    {" · line "}
                    {step.callLine}
                    {step.declaredAt && (
                      <>
                        {" · sig at "}
                        {step.declaredAt.file.replace(/^packages\//, "")}:
                        {step.declaredAt.line}
                      </>
                    )}
                  </span>
                </div>
                {step.declaredReturnType && (
                  <pre className="source-snippet inferred-display">
                    <code>
                      <span className="muted">declared: </span>
                      {step.declaredReturnType}
                    </code>
                  </pre>
                )}
                <pre className="source-snippet inferred-display">
                  <code>
                    <span className="muted">resolved: </span>
                    {step.resolvedType}
                  </code>
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {symbol.inferred && (
        <section className="details-section">
          <h3>Inferred type</h3>
          <p className="muted">
            What the checker actually resolved this declaration to — independent
            of the textual annotation. Counts come from walking the inferred
            type tree via the live <code>TypeChecker</code>; depth is the
            maximum nesting reached during the walk.
          </p>
          <div className="stat-grid">
            <Stat
              label="unique types"
              value={fmtCount(symbol.inferred.uniqueTypes)}
            />
            <Stat label="max depth" value={fmtCount(symbol.inferred.depth)} />
            <Stat
              label="walk limited?"
              value={symbol.inferred.walkLimited ? "yes" : "no"}
            />
          </div>
          <pre className="source-snippet inferred-display">
            <code>{symbol.inferred.display}</code>
          </pre>
          {symbol.inferred.referencedNames.length > 0 && (
            <table className="types-table">
              <thead>
                <tr>
                  <th>name in inferred tree</th>
                  <th>defined at</th>
                  <th className="num">occurrences in tree</th>
                  <th className="num">target entries</th>
                  <th className="num">target call sites</th>
                </tr>
              </thead>
              <tbody>
                {symbol.inferred.referencedNames.map((r) => {
                  const target = findSymbolByName(data.index, r.name);
                  return (
                    <tr key={r.name}>
                      <td className="mono">{r.name}</td>
                      <td className="muted mono">
                        {target ?
                          `${target.file.replace(/^packages\//, "")}:${target.startLine}`
                        : "external / not resolved"}
                      </td>
                      <td className="num">{fmtCount(r.count)}</td>
                      <td className="num">
                        {target ? fmtCount(target.entriesCreated) : "—"}
                      </td>
                      <td className="num">
                        {target ? fmtCount(target.callSites) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="details-section">
        <h3>Checker work attributed to this symbol</h3>
        <p className="muted">
          Number of <code>types.json</code> registry entries whose{" "}
          <code>firstDeclaration</code> overlaps this symbol's source range.
          Each entry is one type the checker materialised (an instantiation, a
          conditional resolution, a mapped-type expansion, an anonymous Object /
          Union / Intersection node). Counts are deterministic and not sampled.
        </p>
        <div className="stat-grid">
          <Stat
            label="entries created"
            value={fmtCount(symbol.entriesCreated)}
          />
          {(symbol.kind === "type" || symbol.kind === "interface") && (
            <Stat
              label="call sites (project)"
              value={fmtCount(symbol.callSites)}
            />
          )}
          <Stat
            label="distinct kinds"
            value={fmtCount(Object.keys(symbol.entriesByKind).length)}
          />
        </div>
        {kindRows.length > 0 && (
          <table className="types-table">
            <thead>
              <tr>
                <th>kind</th>
                <th className="num">count</th>
                <th className="num">share</th>
              </tr>
            </thead>
            <tbody>
              {kindRows.map(([kind, count]) => (
                <tr key={kind}>
                  <td className="mono">{kind}</td>
                  <td className="num">{fmtCount(count)}</td>
                  <td className="num">
                    {symbol.entriesCreated > 0 ?
                      `${((count / symbol.entriesCreated) * 100).toFixed(1)}%`
                    : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="details-section">
        <h3>Type references in this symbol</h3>
        <p className="muted">
          Named types appearing as <code>TypeReference</code> nodes inside this
          symbol's AST. For each, the number of textual occurrences in this
          symbol, and (where it resolves) the target's own stats.
        </p>
        {referenceRows.length === 0 ?
          <p className="muted">No type references in this symbol's range.</p>
        : <table className="types-table">
            <thead>
              <tr>
                <th>name</th>
                <th>defined at</th>
                <th className="num">refs here</th>
                <th className="num">target entries</th>
                <th className="num">target call sites</th>
              </tr>
            </thead>
            <tbody>
              {referenceRows.slice(0, 40).map((r) => (
                <tr key={r.name}>
                  <td className="mono">{r.name}</td>
                  <td className="muted mono">
                    {r.target ?
                      `${r.target.file.replace(/^packages\//, "")}:${r.target.startLine}`
                    : "external / not resolved"}
                  </td>
                  <td className="num">{fmtCount(r.count)}</td>
                  <td className="num">
                    {r.target ? fmtCount(r.target.entriesCreated) : "—"}
                  </td>
                  <td className="num">
                    {r.target ? fmtCount(r.target.callSites) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value mono">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
