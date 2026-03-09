import Terminal from "../Terminal";
import TypeTooltip, { OrderTypeContent } from "../TypeTooltip";
import {
  MongoKeyword,
  MongoField,
  MongoOperator,
  MongoString,
} from "../Terminal/MongoSyntax";
import ErrorIfFiring from "./ErrorIfFiring";
import { useIntersectionObserver, useCompileAnimation } from "../../hooks";
import styles from "./CompileTerminal.module.css";

interface ErrorInfo {
  id: number;
  line: string;
  detail: string;
}

const ERRORS: ErrorInfo[] = [
  {
    id: 1,
    line: "✗ $lookup missing required fields",
    detail: 'Required: "foreignField", "as"',
  },
  {
    id: 2,
    line: "✗ Type 'string' not assignable to 'number'",
    detail: "$gt on number field requires number",
  },
  {
    id: 3,
    line: '✗ "$totl" does not exist on Order',
    detail: 'Did you mean "$total"?',
  },
  {
    id: 4,
    line: "✗ Type 'number' not assignable to 'string'",
    detail: "$concat operands must be strings",
  },
];

export default function CompileTerminal() {
  const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>();
  const {
    showErrors,
    visibleErrors,
    showFixButton,
    fixButtonHidden,
    activeUnderlines,
    activeCursor,
    fixedErrors,
    allFixed,
    handleFix,
  } = useCompileAnimation(isVisible, ERRORS);

  const isErrorFixed = (id: number) => fixedErrors.has(id);

  return (
    <Terminal title="WITH PIPESAFE" terminalRef={ref}>
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
        <TypeTooltip
          content={
            allFixed ?
              <OrderTypeContent
                declaration="largeOrderData"
                properties={[
                  { name: "orderTotalWithTax", type: "number" },
                  { name: "fullName", type: "string" },
                ]}
              />
            : "const largeOrderData: never"
          }
        >
          <MongoField>largeOrderData</MongoField>
        </TypeTooltip>{" "}
        = <MongoField>orders</MongoField>.<MongoKeyword>aggregate</MongoKeyword>
        (){"\n"}
        {"  "}.
        <ErrorIfFiring
          error={{
            message: "$lookup missing required fields",
            detail: 'Required: "foreignField", "as"',
          }}
          isFixed={isErrorFixed(1)}
          isUnderlineActive={activeUnderlines.has(1)}
        >
          lookup
        </ErrorIfFiring>
        ({"{"}
        {"\n"}
        {"    "}
        <MongoField>from</MongoField>: <MongoString>"users"</MongoString>,{"\n"}
        {"    "}
        <MongoField>localField</MongoField>: <MongoString>"userId"</MongoString>
        <span
          className={`${styles.fixableCode} ${isErrorFixed(1) ? styles.isFixed : ""}`}
        >
          <span className={styles.broken}></span>
          <span className={styles.fixed}>
            ,{"\n"}
            {"    "}
            <MongoField>foreignField</MongoField>:{" "}
            <MongoString>"_id"</MongoString>,{"\n"}
            {"    "}
            <MongoField>as</MongoField>: <MongoString>"user"</MongoString>
          </span>
        </span>
        {"\n"}
        {"  "}
        {"})"}
        <span
          className={`${styles.codeCursor} ${activeCursor === 1 ? styles.visible : ""}`}
        ></span>
        {"\n"}
        {"  "}.<MongoKeyword>match</MongoKeyword>({"{"}{" "}
        <MongoField>total</MongoField>: {"{"} <MongoOperator>$gt</MongoOperator>
        :{" "}
        <span
          className={`${styles.fixableCode} ${isErrorFixed(2) ? styles.isFixed : ""}`}
        >
          <ErrorIfFiring
            error={{
              message: "Type 'string' not assignable to 'number'",
              detail: "$gt on number field requires number",
            }}
            isFixed={isErrorFixed(2)}
            isUnderlineActive={activeUnderlines.has(2)}
            className={styles.broken}
          >
            "100"
          </ErrorIfFiring>
          <span className={styles.fixed}>
            <MongoField>100</MongoField>
          </span>
        </span>
        <span
          className={`${styles.codeCursor} ${activeCursor === 2 ? styles.visible : ""}`}
        ></span>{" "}
        {"}"} {"})"}){"\n"}
        {"  "}.<MongoKeyword>set</MongoKeyword>({"{"}
        {"\n"}
        {"    "}
        <MongoField>orderTotalWithTax</MongoField>: {"{"}{" "}
        <MongoOperator>$multiply</MongoOperator>: [
        <span
          className={`${styles.fixableCode} ${isErrorFixed(3) ? styles.isFixed : ""}`}
        >
          <ErrorIfFiring
            error={{
              message: '"$totl" does not exist on Order',
              detail: 'Did you mean "$total"?',
            }}
            isFixed={isErrorFixed(3)}
            isUnderlineActive={activeUnderlines.has(3)}
            className={styles.broken}
          >
            "$totl"
          </ErrorIfFiring>
          <span className={styles.fixed}>
            <MongoString>"$total"</MongoString>
          </span>
        </span>
        <span
          className={`${styles.codeCursor} ${activeCursor === 3 ? styles.visible : ""}`}
        ></span>
        , <MongoField>1.2</MongoField>] {"}"},{"\n"}
        {"    "}
        <MongoField>fullName</MongoField>: {"{"}{" "}
        <MongoOperator>$concat</MongoOperator>: [{"\n"}
        {"      "}
        <MongoString>"$firstName"</MongoString>,{"\n"}
        {"      "}
        <span
          className={`${styles.fixableCode} ${isErrorFixed(4) ? styles.isFixed : ""}`}
        >
          <ErrorIfFiring
            error={{
              message: "Type 'number' not assignable to 'string'",
              detail: "$concat operands must be strings",
            }}
            isFixed={isErrorFixed(4)}
            isUnderlineActive={activeUnderlines.has(4)}
            className={styles.broken}
          >
            123
          </ErrorIfFiring>
          <span className={styles.fixed}>
            <MongoString>" "</MongoString>,{"\n"}
            {"      "}
            <MongoString>"$lastName"</MongoString>
          </span>
        </span>
        <span
          className={`${styles.codeCursor} ${activeCursor === 4 ? styles.visible : ""}`}
        ></span>
        {"\n"}
        {"    "}]{"}"}
        {"\n"}
        {"  "}
        {"})"}){"\n"}
        {"  "}.<MongoKeyword>project</MongoKeyword>({"{"}{" "}
        <MongoField>orderTotalWithTax</MongoField>: <MongoField>1</MongoField>,{" "}
        <MongoField>fullName</MongoField>: <MongoField>1</MongoField> {"}"})
      </pre>

      <div
        className={`${styles.errorSections} ${showErrors ? styles.visible : ""}`}
      >
        <div
          className={`${styles.errorSection} ${allFixed ? styles.shrunk : ""}`}
        >
          <div className={`${styles.errorSectionTitle} ${styles.compile}`}>
            Errors detected at compile time
          </div>
          {ERRORS.map((error) => (
            <div key={error.id}>
              <div
                className={`${styles.errorLine} ${visibleErrors.has(error.id) ? styles.visible : ""} ${isErrorFixed(error.id) ? styles.fadeOut : ""}`}
              >
                {error.line}
              </div>
              <div
                className={`${styles.errorDetail} ${visibleErrors.has(error.id) ? styles.visible : ""} ${isErrorFixed(error.id) ? styles.fadeOut : ""}`}
              >
                {error.detail}
              </div>
            </div>
          ))}
          <button
            className={`${styles.fixBtn} ${showFixButton ? styles.visible : ""} ${fixButtonHidden ? styles.hidden : ""}`}
            onClick={handleFix}
          >
            <span className={styles.lightbulb}>💡</span> Quick Fix with AI
          </button>
          <div
            className={`${styles.allClear} ${allFixed ? styles.visible : ""}`}
          >
            ✓ No errors
          </div>
        </div>
        <div className={styles.errorSection}>
          <div className={`${styles.errorSectionTitle} ${styles.runtime}`}>
            Errors detected at runtime
          </div>
          <div
            className={`${styles.errorSuccess} ${showErrors ? styles.visible : ""}`}
          >
            None — caught before hitting production
          </div>
        </div>
      </div>
    </Terminal>
  );
}
