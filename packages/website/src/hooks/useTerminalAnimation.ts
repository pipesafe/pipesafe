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

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    clearTimeouts();

    // Start deploying
    timeoutsRef.current.push(
      setTimeout(() => {
        setPhase("deploying");
      }, ANIMATION_CONFIG.DEPLOY_START)
    );

    // Mark as deployed, start running
    timeoutsRef.current.push(
      setTimeout(() => {
        setPhase("deployed");
        setTimeout(() => setPhase("running"), 50);
      }, ANIMATION_CONFIG.DEPLOY_START + ANIMATION_CONFIG.DEPLOY_DURATION)
    );

    // Mark as failed
    timeoutsRef.current.push(
      setTimeout(
        () => {
          setPhase("failed");

          // Show error message
          setTimeout(() => {
            setShowErrors(true);

            // Show error note
            setTimeout(() => {
              setShowErrorNote(true);

              // Trigger completion callback
              setTimeout(() => {
                onComplete?.();
              }, 500);
            }, 300);
          }, ANIMATION_CONFIG.ERROR_DELAY);
        },
        ANIMATION_CONFIG.DEPLOY_START +
          ANIMATION_CONFIG.DEPLOY_DURATION +
          ANIMATION_CONFIG.RUN_DURATION
      )
    );

    return clearTimeouts;
  }, [isVisible, onComplete, clearTimeouts]);

  return { phase, showErrors, showErrorNote };
}
