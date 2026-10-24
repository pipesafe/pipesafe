import { useCallback, useEffect, useRef, useState } from "react";

import type { RebuildSnapshot, RebuildTarget } from "./types";

export interface UseRebuild {
  /** Latest job snapshot, or null before the first server message. */
  snapshot: RebuildSnapshot | null;
  /** True while a build is in flight (button should be disabled). */
  busy: boolean;
  /** Set when a POST was rejected because a build was already running. */
  rejected: boolean;
  trigger: (target: RebuildTarget) => void;
}

/**
 * Subscribes to the dev-only rebuild SSE stream and exposes a trigger. Calls
 * `onComplete` exactly once per successful build (deduped by job id) so the
 * caller can re-fetch the dataset in place. No-op outside `vite serve`.
 */
export function useRebuild(onComplete: () => void): UseRebuild {
  const [snapshot, setSnapshot] = useState<RebuildSnapshot | null>(null);
  const [rejected, setRejected] = useState(false);
  // Seeded from the first snapshot, which replays the last finished job.
  const lastDoneId = useRef<number | null>(null);

  // Keep the latest callback without re-subscribing the EventSource.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const source = new EventSource("/__depth/rebuild/stream");
    source.onmessage = (ev: MessageEvent<string>) => {
      const snap = JSON.parse(ev.data) as RebuildSnapshot;
      setSnapshot(snap);
      if (lastDoneId.current === null) {
        lastDoneId.current = snap.running ? 0 : snap.id;
      } else if (
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

  const trigger = useCallback((target: RebuildTarget) => {
    setRejected(false);
    void fetch("/__depth/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
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
