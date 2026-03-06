import type { ReactNode, Ref } from "react";
import styles from "./Terminal.module.css";

interface TerminalProps {
  title: string;
  children: ReactNode;
  terminalRef?: Ref<HTMLDivElement>;
}

export default function Terminal({
  title,
  children,
  terminalRef,
}: TerminalProps) {
  return (
    <div className={styles.terminal} ref={terminalRef} data-terminal>
      <div className={styles.header}>
        <div className={`${styles.dot} ${styles.red}`} />
        <div className={`${styles.dot} ${styles.yellow}`} />
        <div className={`${styles.dot} ${styles.green}`} />
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
