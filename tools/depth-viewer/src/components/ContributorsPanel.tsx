import { useMemo } from "react";

import { fmtCount, fmtUs, indexById, topContributors } from "../data";
import type { AggregatedType, Dataset } from "../types";

interface Props {
  data: Dataset;
  rootTypes: AggregatedType[];
  totalUs: number;
}

export function ContributorsPanel({ data, rootTypes, totalUs }: Props) {
  const byId = useMemo(() => indexById(data.types), [data.types]);
  const rows = useMemo(
    () =>
      topContributors(
        byId,
        data.index,
        rootTypes.map((t) => t.id)
      ),
    [byId, data.index, rootTypes]
  );

  if (rows.length === 0) {
    return (
      <p className="muted">No types reached from this symbol's lineage.</p>
    );
  }

  return (
    <table className="types-table">
      <thead>
        <tr>
          <th>symbol</th>
          <th>file</th>
          <th className="num">total</th>
          <th className="num">events</th>
          <th className="num">types</th>
          <th className="num">share</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 20).map((r) => (
          <tr key={r.key}>
            <td>
              {r.symbolKind && (
                <span className={`tag tag-${r.symbolKind}`}>
                  {r.symbolKind}
                </span>
              )}{" "}
              <span className="mono">{r.symbolName}</span>
            </td>
            <td className="muted mono">
              {r.file ? r.file.replace(/^packages\//, "") : "—"}
            </td>
            <td className="num">{fmtUs(r.totalUs)}</td>
            <td className="num">{fmtCount(r.callCount)}</td>
            <td className="num">{fmtCount(r.typeCount)}</td>
            <td className="num">
              {totalUs > 0 ?
                `${((r.totalUs / totalUs) * 100).toFixed(1)}%`
              : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
