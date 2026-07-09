import { useMemo } from "react";

import { findSymbolByName, fmtCount } from "../data";
import type { Dataset, SymbolStats } from "../types";

/** The checker's three TS2589 ceilings: instantiation depth, count, tail recursion. */
const DEPTH_CEILING = 100;
const COUNT_CEILING = 5_000_000;
const TAIL_CEILING = 1000;

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

  // The first step to trip ANY ceiling is the genuine failure (red). Once it
  // does, the accumulated type collapses to `any`, so every LATER step is
  // unassessable (amber "N/A"): the huge instantiation-count spike on the next
  // step is a by-product of that collapse — not an independent count limit — and
  // every reading after is taken against `any`. Depth's running-max also pins
  // those steps at 100, another carried artefact. `-1` when nothing tripped.
  const firstHitIndex = useMemo(
    () =>
      symbol.inferred?.chain?.findIndex(
        (s) => s.hitDepthLimit || s.hitCountLimit || s.hitTailLimit
      ) ?? -1,
    [symbol.inferred?.chain]
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
            Each step in this declaration's initializer, in execution order,
            with the peak of all three counters TypeScript guards to raise
            TS2589 — read straight from the depth-stats-patched <code>tsc</code>{" "}
            trace, not walked from the resolved type. <strong>depth</strong>{" "}
            (instantiation nesting, ceiling <code>{DEPTH_CEILING}</code>)
            truncates only the <em>deepest</em> branch to <code>any</code> when
            it saturates. <strong>count</strong> (instantiations in one check
            unit, ceiling <code>{COUNT_CEILING.toLocaleString()}</code>) is the
            one that collapses the <em>whole</em> accumulated type to{" "}
            <code>any</code>. <strong>tail</strong> (tail-recursive conditional
            types, ceiling <code>{TAIL_CEILING}</code>) can trip TS2589 at low
            depth. The{" "}
            <span className="depth-limit">
              ⚠ red step is the genuine failure
            </span>{" "}
            — the first counter to hit its ceiling. Every step after it reads{" "}
            <span className="depth-na">amber N/A</span>: the type has already
            collapsed to <code>any</code>, so the count spike the collapse
            itself produces and every later reading can't be assessed. The{" "}
            <em>resolved type</em> is what the checker actually computed here.
          </p>
          <div className="chain">
            {symbol.inferred.chain.map((step, i) => {
              const isTrigger = i === firstHitIndex;
              const isUnassessable = firstHitIndex !== -1 && i > firstHitIndex;
              return (
                <div
                  key={i}
                  className={`chain-step${
                    isTrigger ? " is-trigger"
                    : isUnassessable ? " is-unassessable"
                    : ""
                  }`}
                >
                  <div className="chain-step-header">
                    <span className="mono">{step.label}</span>
                    {isUnassessable ?
                      <span
                        className="chain-depth depth-na"
                        title={`Not assessable. An earlier step tripped a TS2589 ceiling and the accumulated type collapsed to \`any\`. Any counter here is meaningless: the instantiation-count spike on the step right after the failure is a by-product of that collapse (not an independent count limit), depth stays pinned at ${DEPTH_CEILING} as a carried running-max, and every later step resolves against \`any\`.`}
                      >
                        N/A
                      </span>
                    : <>
                        {step.maxDepth !== undefined && (
                          <span
                            className={`chain-depth${isTrigger && step.hitDepthLimit ? " depth-limit" : ""}`}
                            title={
                              `peak instantiation depth (ceiling ${DEPTH_CEILING}): ${step.maxDepth}` +
                              (step.ownDepth !== undefined ?
                                ` · this step's own resolution added: ${step.ownDepth}`
                              : "")
                            }
                          >
                            {isTrigger && step.hitDepthLimit && "⚠ "}
                            depth {fmtCount(step.maxDepth)}
                          </span>
                        )}
                        {step.maxCount !== undefined && (
                          <span
                            className={`chain-depth${isTrigger && step.hitCountLimit ? " depth-limit" : ""}`}
                            title={
                              isTrigger && step.hitCountLimit ?
                                `This step hit the instantiation-count ceiling (${COUNT_CEILING.toLocaleString()}) — the genuine failure, which collapses the whole type to \`any\`. tsc bails at the ceiling, so the exact total is unknown; it had reached ${step.maxCount.toLocaleString()} when it stopped.`
                              : `Marginal instantiations this step performed (ceiling ${COUNT_CEILING.toLocaleString()} collapses the whole type to \`any\`): ${step.maxCount.toLocaleString()}.`
                            }
                          >
                            {isTrigger && step.hitCountLimit ?
                              `⚠ count ≥${fmtCount(COUNT_CEILING)}`
                            : `count ${fmtCount(step.maxCount)}`}
                          </span>
                        )}
                        {step.maxTail !== undefined && step.maxTail > 0 && (
                          <span
                            className={`chain-depth${isTrigger && step.hitTailLimit ? " depth-limit" : ""}`}
                            title={`peak tail-recursion count (ceiling ${TAIL_CEILING}): ${step.maxTail}`}
                          >
                            {isTrigger && step.hitTailLimit && "⚠ "}
                            tail {fmtCount(step.maxTail)}
                          </span>
                        )}
                      </>
                    }
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
              );
            })}
          </div>
        </section>
      )}

      {symbol.inferred && (
        <section className="details-section">
          <h3>Inferred type</h3>
          <p className="muted">
            What the checker actually resolved this declaration to — independent
            of the textual annotation. <strong>Max depth</strong> is the peak
            instantiation depth from the depth-stats-patched <code>tsc</code>{" "}
            trace (not walked from the resolved type); <em>unique types</em> is
            a structural count of the resolved tree, for scale only.
          </p>
          {symbol.inferred.errored && (
            <p className="depth-limit">
              ⚠ The checker returned an error type for this declaration — almost
              always TS2589 ("type instantiation is excessively deep"). The
              resolved type below is the error placeholder, so{" "}
              <em>unique types</em> isn't a meaningful measurement; the per-step
              depth / count / tail above are the real story.
            </p>
          )}
          <div className="stat-grid">
            <Stat
              label="max depth"
              value={
                symbol.inferred.depth !== undefined ?
                  fmtCount(symbol.inferred.depth) +
                  (symbol.inferred.hitDepthLimit ? ` / ${DEPTH_CEILING} ⚠` : "")
                : "n/a"
              }
            />
            {symbol.inferred.count !== undefined &&
              symbol.inferred.count > 0 && (
                <Stat
                  label="max count"
                  value={
                    fmtCount(symbol.inferred.count) +
                    (symbol.inferred.hitCountLimit ?
                      ` / ${COUNT_CEILING.toLocaleString()} ⚠`
                    : "")
                  }
                />
              )}
            {symbol.inferred.tail !== undefined && symbol.inferred.tail > 0 && (
              <Stat
                label="max tail"
                value={
                  fmtCount(symbol.inferred.tail) +
                  (symbol.inferred.hitTailLimit ? ` / ${TAIL_CEILING} ⚠` : "")
                }
              />
            )}
            <Stat
              label="unique types"
              value={
                fmtCount(symbol.inferred.uniqueTypes) +
                (symbol.inferred.walkLimited ? "+" : "")
              }
            />
            <Stat
              label="hit ceiling?"
              value={
                (
                  symbol.inferred.hitDepthLimit ||
                  symbol.inferred.hitCountLimit ||
                  symbol.inferred.hitTailLimit
                ) ?
                  "yes"
                : "no"
              }
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
