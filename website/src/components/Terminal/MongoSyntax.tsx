import type { ReactNode } from "react";
import styles from "./MongoSyntax.module.css";

interface Props {
  children: ReactNode;
}

export function MongoKeyword({ children }: Props) {
  return <span className={styles.keyword}>{children}</span>;
}

export function MongoField({ children }: Props) {
  return <span className={styles.field}>{children}</span>;
}

export function MongoOperator({ children }: Props) {
  return <span className={styles.operator}>{children}</span>;
}

export function MongoString({ children }: Props) {
  return <span className={styles.string}>{children}</span>;
}

export function MongoComment({ children }: Props) {
  return <span className={styles.comment}>{children}</span>;
}
