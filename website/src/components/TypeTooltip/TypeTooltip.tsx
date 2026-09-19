import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./TypeTooltip.module.css";

interface TypeTooltipProps {
  children: ReactNode;
  content: ReactNode;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: "above" | "below";
}

function findTerminalContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    // Look for terminal body class (the scrollable content area)
    if (current.classList.contains("terminal") || current.dataset.terminal) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export default function TypeTooltip({ children, content }: TypeTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isVisible || !triggerRef.current) return;

    const updatePosition = () => {
      const triggerEl = triggerRef.current!;
      const triggerRect = triggerEl.getBoundingClientRect();
      const tooltipEl = tooltipRef.current;
      const tooltipHeight = tooltipEl?.offsetHeight ?? 150;
      const tooltipWidth = tooltipEl?.offsetWidth ?? 300;

      // Find the terminal container to constrain tooltip within
      const container = findTerminalContainer(triggerEl);
      const containerRect = container?.getBoundingClientRect();

      // Calculate space within container (or viewport if no container)
      const containerTop = containerRect?.top ?? 0;
      const containerBottom = containerRect?.bottom ?? window.innerHeight;
      const containerLeft = containerRect?.left ?? 0;
      const containerRight = containerRect?.right ?? window.innerWidth;

      const spaceAbove = triggerRect.top - containerTop;
      const spaceBelow = containerBottom - triggerRect.bottom;

      // Choose placement based on available space within container
      const placement =
        spaceAbove >= tooltipHeight + 12 ? "above"
        : spaceBelow >= tooltipHeight + 12 ? "below"
        : spaceAbove > spaceBelow ? "above"
        : "below";

      // Calculate vertical position
      const top =
        placement === "above" ? triggerRect.top - 8 : triggerRect.bottom + 8;

      // Position from left edge of trigger, offset slightly for the arrow
      let left = triggerRect.left - 6;

      // Adjust horizontal position to keep tooltip within container bounds
      const minLeft = containerLeft + 8;
      const maxLeft = containerRight - tooltipWidth - 8;
      left = Math.max(minLeft, Math.min(maxLeft, left));

      setPosition({ top, left, placement });
    };

    updatePosition();
  }, [isVisible]);

  const handleMouseEnter = () => {
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
    setPosition(null);
  };

  const tooltip = isVisible && position && (
    <div
      ref={tooltipRef}
      className={`${styles.tooltip} ${styles.visible} ${styles[position.placement]}`}
      style={{
        top: position.top,
        left: position.left,
      }}
      role="tooltip"
    >
      <div className={styles.content}>{content}</div>
    </div>
  );

  return (
    <span
      ref={triggerRef}
      className={styles.trigger}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {createPortal(tooltip, document.body)}
    </span>
  );
}
