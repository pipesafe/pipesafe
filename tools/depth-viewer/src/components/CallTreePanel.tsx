import { useMemo } from "react";

import { fmtCount, fmtUs, indexById, lineageOf } from "../data";
import type { AggregatedType, Dataset } from "../types";

interface Props {
  data: Dataset;
  rootTypes: AggregatedType[];
}

export function CallTreePanel({ data, rootTypes }: Props) {
  const byId = useMemo(() => indexById(data.types), [data.types]);
  const lineages = useMemo(
    () =>
      rootTypes
        .filter((t) => t.totalUs > 0 || t.parent !== undefined)
        .slice(0, 10)
        .map((t) => lineageOf(byId, t.id)),
    [byId, rootTypes]
  );

  if (lineages.length === 0) {
    return (
      <p className="muted">
        This symbol has no named types whose lineage we can walk.
      </p>
    );
  }

  return (
    <div className="call-tree">
      {lineages.map((chain) => (
        <details key={chain.root.id} className="lineage" open>
          <summary>
            <span className="mono">{chain.root.name}</span>
            <span className="muted">
              {" · "}
              {fmtUs(chain.root.totalUs)} · {fmtCount(chain.root.callCount)}{" "}
              events
            </span>
            <span className="muted">
              {chain.steps.length === 0 ?
                " · no parent"
              : ` · ${chain.steps.length} ancestors`}
            </span>
          </summary>
          {chain.steps.length > 0 && (
            <ul className="lineage-steps">
              {chain.steps.map((step, i) => (
                <li key={`${step.type.id}-${i}`} className="lineage-step">
                  <span className="lineage-bar" aria-hidden>
                    {"└─".padStart(2 + i * 2, " ")}
                  </span>
                  <span className="mono">{step.type.name}</span>
                  {step.repeats > 1 && (
                    <span className="lineage-repeats">×{step.repeats}</span>
                  )}
                  <span className="muted">
                    {step.type.file ?
                      ` ${step.type.file.replace(/^packages\//, "")}:${step.type.line ?? "?"}`
                    : " <external>"}
                  </span>
                  <span className="muted">
                    {" · "}
                    {fmtUs(step.type.totalUs)}
                  </span>
                </li>
              ))}
              {chain.truncated && (
                <li className="lineage-step muted">
                  …truncated at depth limit
                </li>
              )}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}
