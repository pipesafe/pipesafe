import { useMemo } from "react";

import { expressionCostInRange, fmtCount, fmtUs, typesInRange } from "../data";
import type { Dataset, SymbolEntry } from "../types";

import { CallTreePanel } from "./CallTreePanel";
import { ContributorsPanel } from "./ContributorsPanel";

interface Props {
  data: Dataset;
  file: string;
  symbol: SymbolEntry;
}

export function DetailsPanel({ data, file, symbol }: Props) {
  const exprStats = useMemo(
    () =>
      expressionCostInRange(
        data.expressions[file],
        symbol.startPos,
        symbol.endPos
      ),
    [data.expressions, file, symbol.startPos, symbol.endPos]
  );

  const ownTypes = useMemo(
    () => typesInRange(data.types, file, symbol.startLine, symbol.endLine),
    [data.types, file, symbol.startLine, symbol.endLine]
  );
  const ownTypesSorted = useMemo(
    () => [...ownTypes].sort((a, b) => b.totalUs - a.totalUs),
    [ownTypes]
  );

  const ownTypesTotalUs = ownTypes.reduce((acc, t) => acc + t.totalUs, 0);
  const ownTypesCallCount = ownTypes.reduce((acc, t) => acc + t.callCount, 0);

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
      </header>

      <section className="details-section">
        <h3>Expression check time</h3>
        <p className="muted">
          Sum of <code>checkExpression</code> events whose source range falls
          inside this symbol. Reflects the <em>total</em> cost of checking this
          expression — including types defined elsewhere.
        </p>
        <div className="stat-grid">
          <Stat label="total time" value={fmtUs(exprStats.totalUs)} />
          <Stat label="events" value={fmtCount(exprStats.callCount)} />
          <Stat
            label="% of compile"
            value={
              data.meta.totalUs ?
                `${((exprStats.totalUs / data.meta.totalUs) * 100).toFixed(2)}%`
              : "—"
            }
          />
        </div>
      </section>

      <section className="details-section">
        <h3>Types declared in this symbol</h3>
        <p className="muted">
          Named types whose <code>firstDeclaration</code> falls inside the
          symbol's lines. These are the types the checker created here.
        </p>
        <div className="stat-grid">
          <Stat label="types" value={fmtCount(ownTypes.length)} />
          <Stat label="total time" value={fmtUs(ownTypesTotalUs)} />
          <Stat label="events" value={fmtCount(ownTypesCallCount)} />
        </div>
        {ownTypesSorted.length > 0 ?
          <table className="types-table">
            <thead>
              <tr>
                <th>type</th>
                <th>total</th>
                <th>events</th>
                <th>line</th>
              </tr>
            </thead>
            <tbody>
              {ownTypesSorted.slice(0, 20).map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.name}</td>
                  <td className="num">{fmtUs(t.totalUs)}</td>
                  <td className="num">{fmtCount(t.callCount)}</td>
                  <td className="num">{t.line ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        : <p className="muted">No named types declared inside this symbol.</p>}
      </section>

      <section className="details-section">
        <h3>Top contributing symbols</h3>
        <p className="muted">
          Walks each owned type's <code>instantiatedType</code> chain upward and
          groups every encountered type by its source-symbol owner. Shows which
          other constants/types feed the most cost into this symbol's lineage.
        </p>
        <ContributorsPanel
          data={data}
          rootTypes={ownTypes}
          totalUs={ownTypesTotalUs}
        />
      </section>

      <section className="details-section">
        <h3>Lineage tree</h3>
        <p className="muted">
          For each named type owned by this symbol, the chain of generics it was
          instantiated from. Repeating cycles are folded with a{" "}
          <span className="lineage-repeats">×N</span> count.
        </p>
        <CallTreePanel data={data} rootTypes={ownTypes} />
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
