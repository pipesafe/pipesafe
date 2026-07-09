import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Snapshot of the dev server's build job. Mirrors `RebuildSnapshot` in
 * ../rebuild-plugin.ts — kept as a separate declaration because that module
 * imports Node built-ins and must not be pulled into the browser bundle.
 */
export interface RebuildSnapshot {
  id: number;
  running: boolean;
  target: string;
  phase: string;
  startedAt: number;
  endedAt: number | null;
  log: string[];
  exitCode: number | null;
  error: string | null;
}

export interface RebuildTarget {
  target: "coverage" | "sample";
  patch: boolean;
}

export interface UseRebuild {
  /** Latest job snapshot, or null before the first server message. */
  snapshot: RebuildSnapshot | null;
  /** True while a build is in flight (button should be disabled). */
  busy: boolean;
  /** Set when a POST was rejected because a build was already running. */
  rejected: boolean;
  trigger: (opts: RebuildTarget) => void;
}

/**
 * Subscribes to the dev-only rebuild SSE stream and exposes a trigger. Calls
 * `onComplete` exactly once per successful build (deduped by job id) so the
 * caller can re-fetch the dataset in place. No-op outside `vite serve`.
 */
export function useRebuild(onComplete: () => void): UseRebuild {
  const [snapshot, setSnapshot] = useState<RebuildSnapshot | null>(null);
  const [rejected, setRejected] = useState(false);
  const lastDoneId = useRef(0);

  // Keep the latest callback without re-subscribing the EventSource.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const source = new EventSource("/__depth/rebuild/stream");
    source.onmessage = (ev: MessageEvent<string>) => {
      const snap = JSON.parse(ev.data) as RebuildSnapshot;
      setSnapshot(snap);
      if (
        !snap.running &&
        snap.exitCode === 0 &&
        snap.id > 0 &&
        snap.id !== lastDoneId.current
      ) {
        lastDoneId.current = snap.id;
        onCompleteRef.current();
      }
    };
    return () => source.close();
  }, []);

  const trigger = useCallback((opts: RebuildTarget) => {
    setRejected(false);
    void fetch("/__depth/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }).then((res) => {
      // 409 => a build was already running; the stream keeps us in sync.
      if (res.status === 409) setRejected(true);
    });
  }, []);

  return {
    snapshot,
    busy: snapshot?.running ?? false,
    rejected,
    trigger,
  };
}
