import { useState } from "react";

import type { RebuildSnapshot, RebuildTarget } from "../rebuild";

interface Props {
  snapshot: RebuildSnapshot | null;
  busy: boolean;
  rejected: boolean;
  /** True while the app is re-fetching the freshly built dataset. */
  reloading: boolean;
  onTrigger: (opts: RebuildTarget) => void;
  variant: "header" | "empty";
}

const TARGETS: { value: RebuildTarget["target"]; label: string }[] = [
  { value: "coverage", label: "coverage (full)" },
  { value: "sample", label: "sample (fast)" },
];

/**
 * Dev-only control that rebuilds the dataset from the browser and shows live
 * progress. The heavy build is single-flighted on the server, so the button is
 * disabled for the whole run (start → build → in-place reload) and can't be
 * mashed into launching a second one.
 */
export function RebuildButton({
  snapshot,
  busy,
  rejected,
  reloading,
  onTrigger,
  variant,
}: Props) {
  const [target, setTarget] = useState<RebuildTarget["target"]>("coverage");

  const active = busy || reloading;
  const phase =
    reloading ? "Reloading…"
    : busy ? (snapshot?.phase ?? "Starting…")
    : null;
  const failed = !busy && snapshot?.exitCode != null && snapshot.exitCode !== 0;

  return (
    <div className={`rebuild rebuild-${variant}`}>
      <div className="rebuild-controls">
        <select
          className="rebuild-target"
          value={target}
          disabled={active}
          onChange={(e) => setTarget(e.target.value as RebuildTarget["target"])}
        >
          {TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rebuild-btn"
          disabled={active}
          onClick={() => onTrigger({ target, patch: target === "coverage" })}
        >
          {active ?
            <>
              <span className="rebuild-spinner" aria-hidden="true" />
              {phase}
            </>
          : "Rebuild dataset"}
        </button>
      </div>

      {rejected && !active ?
        <p className="rebuild-note">A build is already running.</p>
      : null}

      {active && snapshot?.log.length ?
        <pre className="rebuild-log">{snapshot.log.slice(-8).join("\n")}</pre>
      : null}

      {failed && snapshot?.error ?
        <details className="rebuild-error" open>
          <summary>Build failed (exit {snapshot.exitCode})</summary>
          <pre>{snapshot.error}</pre>
        </details>
      : null}

      {variant === "empty" ?
        <p className="rebuild-hint">
          Or run <code>bun run depth-view:build</code> in a terminal. The full
          coverage build is a cold <code>tsc --generateTrace</code> over both
          packages and takes several minutes; pick <em>sample</em> for a quick
          end-to-end check.
        </p>
      : null}
    </div>
  );
}
