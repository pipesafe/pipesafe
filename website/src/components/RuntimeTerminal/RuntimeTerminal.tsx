import Terminal from "../Terminal";
import TypeTooltip, { OrderTypeContent } from "../TypeTooltip";
import {
  MongoKeyword,
  MongoField,
  MongoOperator,
  MongoString,
  MongoComment,
} from "../Terminal/MongoSyntax";
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
        <MongoKeyword>const</MongoKeyword>{" "}
        <TypeTooltip content="const orders: Collection<Order>">
          <MongoField>orders</MongoField>
        </TypeTooltip>{" "}
        = <MongoField>db</MongoField>.<MongoKeyword>collection</MongoKeyword>
        &lt;
        <TypeTooltip content={<OrderTypeContent />}>
          <MongoKeyword>Order</MongoKeyword>
        </TypeTooltip>
        &gt;(
        <MongoString>'orders'</MongoString>){"\n"}
        {"\n"}
        <MongoKeyword>const</MongoKeyword>{" "}
        <TypeTooltip content="const largeOrderData: any">
          <MongoField>largeOrderData</MongoField>
        </TypeTooltip>{" "}
        = <MongoField>orders</MongoField>.<MongoKeyword>aggregate</MongoKeyword>
        ([{"\n"}
        {"  "}
        {"{"} <MongoString>$lookup</MongoString>: {"{"}
        {"\n"}
        {"    "}
        <MongoField>from</MongoField>: <MongoString>"users"</MongoString>,{"\n"}
        {"    "}
        <MongoField>localField</MongoField>: <MongoString>"userId"</MongoString>
        {"\n"}
        {"    "}
        <MongoComment>{"// missing foreignField and as"}</MongoComment>
        {"\n"}
        {"  "}
        {"}}"},{"\n"}
        {"  "}
        {"{"} <MongoString>$match</MongoString>: {"{"}{" "}
        <MongoField>total</MongoField>: {"{"} <MongoOperator>$gt</MongoOperator>
        : <MongoString>"100"</MongoString> {"}"} {"}}"},{"\n"}
        {"  "}
        {"{"} <MongoString>$set</MongoString>: {"{"}
        {"\n"}
        {"    "}
        <MongoField>orderTotalWithTax</MongoField>: {"{"}{" "}
        <MongoOperator>$multiply</MongoOperator>: [
        <MongoString>"$totl"</MongoString>, <MongoField>1.2</MongoField>] {"}"},
        {"\n"}
        {"    "}
        <MongoField>fullName</MongoField>: {"{"}{" "}
        <MongoOperator>$concat</MongoOperator>: [{"\n"}
        {"      "}
        <MongoString>"$firstName"</MongoString>,{"\n"}
        {"      "}
        <MongoField>123</MongoField>
        {"\n"}
        {"    "}]{"}"}
        {"\n"}
        {"  "}
        {"}}"},{"\n"}
        {"  "}
        {"{"} <MongoString>$project</MongoString>: {"{"}{" "}
        <MongoField>orderTotalWithTax</MongoField>: <MongoField>1</MongoField>,{" "}
        <MongoField>fullName</MongoField>: <MongoField>1</MongoField> {"}"}{" "}
        {"}"}
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
