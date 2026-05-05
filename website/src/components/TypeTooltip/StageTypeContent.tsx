import type { ReactNode } from "react";
import styles from "./TypeTooltip.module.css";

interface StageTypeContentProps {
  method: string;
  input: ReactNode;
  output: ReactNode;
}

export default function StageTypeContent({
  method,
  input,
  output,
}: StageTypeContentProps) {
  return (
    <>
      <span className={styles.comment}>(method)</span>{" "}
      <span className={styles.property}>.{method}</span>
      {"\n\n"}
      <span className={styles.comment}>{"// input"}</span>
      {"\n"}
      <span className={styles.typeName}>{input}</span>
      {"\n\n"}
      <span className={styles.comment}>{"// output"}</span>
      {"\n"}
      <span className={styles.typeName}>{output}</span>
    </>
  );
}
