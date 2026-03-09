import type { ReactNode } from "react";
import TypeTooltip, { ErrorTooltipContent } from "../TypeTooltip";
import styles from "./CompileTerminal.module.css";

interface ErrorMessage {
  message: string;
  detail: string;
}

interface ErrorIfFiringProps {
  error: ErrorMessage;
  isFixed: boolean;
  isUnderlineActive: boolean;
  className?: string;
  children: ReactNode;
}

export default function ErrorIfFiring({
  error,
  isFixed,
  isUnderlineActive,
  className,
  children,
}: ErrorIfFiringProps) {
  if (isFixed) {
    return <span className={className}>{children}</span>;
  }

  return (
    <TypeTooltip
      content={
        <ErrorTooltipContent message={error.message} detail={error.detail} />
      }
    >
      <span
        className={`${className ? `${className} ` : ""}${styles.errorUnderline} ${isUnderlineActive ? styles.active : ""}`}
      >
        {children}
      </span>
    </TypeTooltip>
  );
}
