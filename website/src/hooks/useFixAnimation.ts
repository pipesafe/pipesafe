import { useState, useCallback, useEffect, useRef } from "react";
import { ANIMATION_CONFIG } from "../constants/animation";

interface UseFixAnimationResult {
  activeCursor: number | null;
  fixedErrors: Set<number>;
  allFixed: boolean;
  startFixing: () => void;
}

export function useFixAnimation(errorCount = 4): UseFixAnimationResult {
  const [activeCursor, setActiveCursor] = useState<number | null>(null);
  const [fixedErrors, setFixedErrors] = useState<Set<number>>(new Set());
  const [allFixed, setAllFixed] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const startFixing = useCallback(() => {
    // Clear any existing timeouts
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];

    const fixes = Array.from({ length: errorCount }, (_, i) => i + 1);

    fixes.forEach((fixNum, index) => {
      const fixTime = index * ANIMATION_CONFIG.FIX_STAGGER;

      // Show cursor
      timeoutsRef.current.push(
        setTimeout(() => {
          setActiveCursor(fixNum);
        }, fixTime)
      );

      // Apply fix
      timeoutsRef.current.push(
        setTimeout(() => {
          setFixedErrors((prev) => new Set(prev).add(fixNum));
        }, fixTime + ANIMATION_CONFIG.FIX_CURSOR_DURATION)
      );
    });

    // After all fixes complete
    const allFixedTime =
      fixes.length * ANIMATION_CONFIG.FIX_STAGGER +
      ANIMATION_CONFIG.FIX_CURSOR_DURATION +
      300;

    timeoutsRef.current.push(
      setTimeout(() => {
        setActiveCursor(null);
        setAllFixed(true);
      }, allFixedTime)
    );
  }, [errorCount]);

  return { activeCursor, fixedErrors, allFixed, startFixing };
}
