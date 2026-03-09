import { useState, useEffect, useRef, useCallback } from "react";
import { ANIMATION_CONFIG } from "../constants/animation";

export type RuntimePhase =
  | "idle"
  | "deploying"
  | "deployed"
  | "running"
  | "failed";

interface UseTerminalAnimationResult {
  phase: RuntimePhase;
  showErrors: boolean;
  showErrorNote: boolean;
}

export function useTerminalAnimation(
  isVisible: boolean,
  onComplete?: () => void
): UseTerminalAnimationResult {
  const [phase, setPhase] = useState<RuntimePhase>("idle");
  const [showErrors, setShowErrors] = useState(false);
  const [showErrorNote, setShowErrorNote] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    clearTimeouts();

    const deployEnd =
      ANIMATION_CONFIG.DEPLOY_START + ANIMATION_CONFIG.DEPLOY_DURATION;
    const failTime = deployEnd + ANIMATION_CONFIG.RUN_DURATION;

    // Start deploying
    timeoutsRef.current.push(
      setTimeout(() => setPhase("deploying"), ANIMATION_CONFIG.DEPLOY_START)
    );

    // Mark as deployed
    timeoutsRef.current.push(setTimeout(() => setPhase("deployed"), deployEnd));

    // Start running
    timeoutsRef.current.push(
      setTimeout(() => setPhase("running"), deployEnd + 50)
    );

    // Mark as failed
    timeoutsRef.current.push(setTimeout(() => setPhase("failed"), failTime));

    // Show error message
    timeoutsRef.current.push(
      setTimeout(
        () => setShowErrors(true),
        failTime + ANIMATION_CONFIG.ERROR_DELAY
      )
    );

    // Show error note
    timeoutsRef.current.push(
      setTimeout(
        () => setShowErrorNote(true),
        failTime + ANIMATION_CONFIG.ERROR_DELAY + 300
      )
    );

    // Trigger completion callback
    timeoutsRef.current.push(
      setTimeout(
        () => onCompleteRef.current?.(),
        failTime + ANIMATION_CONFIG.ERROR_DELAY + 800
      )
    );

    return clearTimeouts;
  }, [isVisible, clearTimeouts]);

  return { phase, showErrors, showErrorNote };
}
