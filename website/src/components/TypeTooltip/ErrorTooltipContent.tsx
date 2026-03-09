import styles from "./TypeTooltip.module.css";

interface ErrorTooltipContentProps {
  message: string;
  detail?: string;
}

export default function ErrorTooltipContent({
  message,
  detail,
}: ErrorTooltipContentProps) {
  return (
    <div className={styles.errorTooltip}>
      <span className={styles.errorMessage}>{message}</span>
      {detail && (
        <>
          {"\n"}
          <span className={styles.errorDetail}>{detail}</span>
        </>
      )}
    </div>
  );
}
