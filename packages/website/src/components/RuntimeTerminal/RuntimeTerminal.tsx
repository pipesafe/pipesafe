import Terminal from "../Terminal";
import TypeTooltip from "../TypeTooltip";
import { useIntersectionObserver, useTerminalAnimation } from "../../hooks";
import styles from "./RuntimeTerminal.module.css";

interface RuntimeTerminalProps {
  onAnimationComplete?: () => void;
}

export default function RuntimeTerminal({
  onAnimationComplete,
}: RuntimeTerminalProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>();
  const { phase, showErrors, showErrorNote } = useTerminalAnimation(
    isVisible,
    onAnimationComplete
  );

  const showDeploying = phase !== "idle";
  const deployDone =
    phase === "deployed" || phase === "running" || phase === "failed";
  const showRunning = deployDone;
  const runFailed = phase === "failed";

  return (
    <Terminal title="WITHOUT PIPESAFE" terminalRef={ref}>
      <pre className={styles.code}>
        <span className={styles.keyword}>const</span>{" "}
        <TypeTooltip content="const orders: Collection<Order>">
          <span className={styles.field}>orders</span>
        </TypeTooltip>{" "}
        = <span className={styles.field}>db</span>.
        <span className={styles.keyword}>collection</span>&lt;
        <span className={styles.keyword}>Order</span>&gt;(
        <span className={styles.string}>'orders'</span>){"\n"}
        {"\n"}
        <span className={styles.keyword}>const</span>{" "}
        <TypeTooltip content="const largeOrderData: any">
          <span className={styles.field}>largeOrderData</span>
        </TypeTooltip>{" "}
        = <span className={styles.field}>orders</span>.
        <span className={styles.keyword}>aggregate</span>([{"\n"}
        {"  "}
        {"{"} <span className={styles.string}>$lookup</span>: {"{"}
        {"\n"}
        {"    "}
        <span className={styles.field}>from</span>:{" "}
        <span className={styles.string}>"users"</span>,{"\n"}
        {"    "}
        <span className={styles.field}>localField</span>:{" "}
        <span className={styles.string}>"userId"</span>
        {"\n"}
        {"    "}
        <span className={styles.comment}>
          {"// missing foreignField and as"}
        </span>
        {"\n"}
        {"  "}
        {"}}"},{"\n"}
        {"  "}
        {"{"} <span className={styles.string}>$match</span>: {"{"}{" "}
        <span className={styles.field}>total</span>: {"{"}{" "}
        <span className={styles.operator}>$gt</span>:{" "}
        <span className={styles.string}>"100"</span> {"}"} {"}}"},{"\n"}
        {"  "}
        {"{"} <span className={styles.string}>$set</span>: {"{"}
        {"\n"}
        {"    "}
        <span className={styles.field}>orderTotalWithTax</span>: {"{"}{" "}
        <span className={styles.operator}>$multiply</span>: [
        <span className={styles.string}>"$totl"</span>,{" "}
        <span className={styles.field}>1.2</span>] {"}"},{"\n"}
        {"    "}
        <span className={styles.field}>fullName</span>: {"{"}{" "}
        <span className={styles.operator}>$concat</span>: [{"\n"}
        {"      "}
        <span className={styles.string}>"$firstName"</span>,{"\n"}
        {"      "}
        <span className={styles.field}>123</span>
        {"\n"}
        {"    "}]{"}"}
        {"\n"}
        {"  "}
        {"}}"},{"\n"}
        {"  "}
        {"{"} <span className={styles.string}>$project</span>: {"{"}{" "}
        <span className={styles.field}>orderTotalWithTax</span>:{" "}
        <span className={styles.field}>1</span>,{" "}
        <span className={styles.field}>fullName</span>:{" "}
        <span className={styles.field}>1</span> {"}"} {"}"}
        {"\n"}])
      </pre>

      <div
        className={`${styles.stepIndicator} ${showDeploying ? styles.visible : ""} ${deployDone ? styles.done : ""}`}
      >
        <span className={styles.stepRunning}>
          {">"} Deploying to staging<span className={styles.dots}></span>
        </span>
        <span className={styles.stepDone}>✓ Deployed to staging</span>
      </div>

      <div
        className={`${styles.stepIndicator} ${showRunning ? styles.visible : ""} ${runFailed ? styles.done : ""}`}
      >
        <span className={styles.stepRunning}>
          {">"} Running pipeline<span className={styles.dots}></span>
        </span>
        <span className={`${styles.stepDone} ${styles.stepFailed}`}>
          ✗ Pipeline failed
        </span>
      </div>

      <div
        className={`${styles.errorSections} ${showErrors ? styles.visible : ""}`}
      >
        <div className={styles.errorSection}>
          <div className={`${styles.errorSectionTitle} ${styles.compile}`}>
            Errors detected at compile time
          </div>
          <div className={styles.errorNone}>None</div>
        </div>
        <div className={styles.errorSection}>
          <div className={`${styles.errorSectionTitle} ${styles.runtime}`}>
            Errors detected at runtime
          </div>
          <div
            className={`${styles.runtimeErrorMsg} ${showErrors ? styles.visible : ""}`}
          >
            {">"} MongoServerError: must specify 'as' field for a $lookup
          </div>
          <div
            className={`${styles.runtimeErrorNote} ${showErrorNote ? styles.visible : ""}`}
          >
            The other 3 bugs? No error. Wrong results. Good luck.
          </div>
        </div>
      </div>
    </Terminal>
  );
}
