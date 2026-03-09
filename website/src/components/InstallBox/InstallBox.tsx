import { useCopyToClipboard } from "../../hooks";
import styles from "./InstallBox.module.css";

const INSTALL_COMMAND = "npm install @pipesafe/core";

export default function InstallBox() {
  const [copied, copy] = useCopyToClipboard();

  const handleClick = () => {
    void copy(INSTALL_COMMAND);
  };

  return (
    <div
      className={styles.installBox}
      onClick={handleClick}
      title="Click to copy"
      aria-label="Copy install command"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick();
        }
      }}
    >
      <span className={styles.prompt}>$</span>
      <span className={styles.command}>{INSTALL_COMMAND}</span>
      <span className={`${styles.feedback} ${copied ? styles.visible : ""}`}>
        Copied!
      </span>
    </div>
  );
}
