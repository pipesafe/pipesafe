import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useFixAnimation } from "./useFixAnimation";
import { ANIMATION_CONFIG } from "../constants/animation";

interface ErrorDef {
  id: number;
}

interface UseCompileAnimationResult {
  showErrors: boolean;
  visibleErrors: Set<number>;
  showFixButton: boolean;
  fixButtonHidden: boolean;
  activeUnderlines: Set<number>;
  activeCursor: number | null;
  fixedErrors: Set<number>;
  allFixed: boolean;
  handleFix: () => void;
}

export function useCompileAnimation(
  isVisible: boolean,
  errors: ErrorDef[]
): UseCompileAnimationResult {
  const [showErrors, setShowErrors] = useState(false);
  const [visibleErrors, setVisibleErrors] = useState<Set<number>>(new Set());
  const [showFixButton, setShowFixButton] = useState(false);
  const [fixButtonHidden, setFixButtonHidden] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { activeCursor, fixedErrors, allFixed, startFixing } = useFixAnimation(
    errors.length
  );

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  }, []);

  // Derive activeUnderlines: visible errors that haven't been fixed yet
  const activeUnderlines = useMemo(() => {
    const result = new Set(visibleErrors);
    fixedErrors.forEach((id) => result.delete(id));
    return result;
  }, [visibleErrors, fixedErrors]);

  // Animate errors appearing when visible
  useEffect(() => {
    if (!isVisible) return;

    clearTimeouts();

    // Show error sections
    timeoutsRef.current.push(
      setTimeout(() => {
        setShowErrors(true);
      }, ANIMATION_CONFIG.COMPILE_START)
    );

    // Animate each error
    errors.forEach((error, index) => {
      const delay =
        ANIMATION_CONFIG.COMPILE_START +
        (index + 1) * ANIMATION_CONFIG.COMPILE_STAGGER;

      timeoutsRef.current.push(
        setTimeout(() => {
          setVisibleErrors((prev) => new Set(prev).add(error.id));
        }, delay)
      );
    });

    // Show fix button
    timeoutsRef.current.push(
      setTimeout(
        () => {
          setShowFixButton(true);
        },
        ANIMATION_CONFIG.COMPILE_START +
          (errors.length + 1) * ANIMATION_CONFIG.COMPILE_STAGGER
      )
    );

    return clearTimeouts;
  }, [isVisible, errors, clearTimeouts]);

  const handleFix = useCallback(() => {
    setFixButtonHidden(true);
    startFixing();
  }, [startFixing]);

  return {
    showErrors,
    visibleErrors,
    showFixButton,
    fixButtonHidden,
    activeUnderlines,
    activeCursor,
    fixedErrors,
    allFixed,
    handleFix,
  };
}
