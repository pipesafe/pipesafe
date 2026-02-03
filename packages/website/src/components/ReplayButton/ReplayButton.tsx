import styles from "./ReplayButton.module.css";

interface ReplayButtonProps {
  visible: boolean;
  onReplay: () => void;
}

export default function ReplayButton({ visible, onReplay }: ReplayButtonProps) {
  return (
    <div className={`${styles.container} ${visible ? styles.visible : ""}`}>
      <button className={styles.button} onClick={onReplay}>
        Replay
      </button>
    </div>
  );
}
