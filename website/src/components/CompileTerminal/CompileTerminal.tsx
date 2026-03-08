import { useState, useEffect, useRef } from "react";
import Terminal from "../Terminal";
import TypeTooltip, {
  OrderTypeContent,
  ErrorTooltipContent,
} from "../TypeTooltip";
import { useIntersectionObserver, useFixAnimation } from "../../hooks";
import { ANIMATION_CONFIG } from "../../constants/animation";
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
  const [showErrors, setShowErrors] = useState(false);
  const [visibleErrors, setVisibleErrors] = useState<Set<number>>(new Set());
  const [showFixButton, setShowFixButton] = useState(false);
  const [fixButtonHidden, setFixButtonHidden] = useState(false);
  const [activeUnderlines, setActiveUnderlines] = useState<Set<number>>(
    new Set()
  );
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { activeCursor, fixedErrors, allFixed, startFixing } =
    useFixAnimation(4);

  // Animate errors appearing when visible
  useEffect(() => {
    if (!isVisible) return;

    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];

    // Show error sections
    timeoutsRef.current.push(
      setTimeout(() => {
        setShowErrors(true);
      }, ANIMATION_CONFIG.COMPILE_START)
    );

    // Animate each error
    ERRORS.forEach((error, index) => {
      const delay =
        ANIMATION_CONFIG.COMPILE_START +
        (index + 1) * ANIMATION_CONFIG.COMPILE_STAGGER;

      timeoutsRef.current.push(
        setTimeout(() => {
          setActiveUnderlines((prev) => new Set([...prev, error.id]));
          setVisibleErrors((prev) => new Set([...prev, error.id]));
        }, delay)
      );
    });

    // Show fix button
    timeoutsRef.current.push(
      setTimeout(
        () => {
          setShowFixButton(true);
        },
        ANIMATION_CONFIG.COMPILE_START + 5 * ANIMATION_CONFIG.COMPILE_STAGGER
      )
    );

    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
    };
  }, [isVisible]);

  // Remove underlines when errors are fixed
  useEffect(() => {
    fixedErrors.forEach((id) => {
      setActiveUnderlines((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }, [fixedErrors]);

  const handleFix = () => {
    setFixButtonHidden(true);
    startFixing();
  };

  const isErrorFixed = (id: number) => fixedErrors.has(id);

  return (
    <Terminal title="WITH PIPESAFE" terminalRef={ref}>
      <pre className={styles.code}>
        <span className={styles.keyword}>const</span>{" "}
        <TypeTooltip content="const orders: Collection<Order>">
          <span className={styles.field}>orders</span>
        </TypeTooltip>{" "}
        = <span className={styles.field}>db</span>.
        <span className={styles.keyword}>collection</span>&lt;
        <TypeTooltip content={<OrderTypeContent />}>
          <span className={styles.keyword}>Order</span>
        </TypeTooltip>
        &gt;(
        <span className={styles.string}>'orders'</span>){"\n"}
        {"\n"}
        <span className={styles.keyword}>const</span>{" "}
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
          <span className={styles.field}>largeOrderData</span>
        </TypeTooltip>{" "}
        = <span className={styles.field}>orders</span>.
        <span className={styles.keyword}>aggregate</span>(){"\n"}
        {"  "}.
        {isErrorFixed(1) ?
          <span>lookup</span>
        : <TypeTooltip
            content={
              <ErrorTooltipContent
                message="$lookup missing required fields"
                detail='Required: "foreignField", "as"'
              />
            }
          >
            <span
              className={`${styles.errorUnderline} ${activeUnderlines.has(1) ? styles.active : ""}`}
            >
              lookup
            </span>
          </TypeTooltip>
        }
        ({"{"}
        {"\n"}
        {"    "}
        <span className={styles.field}>from</span>:{" "}
        <span className={styles.string}>"users"</span>,{"\n"}
        {"    "}
        <span className={styles.field}>localField</span>:{" "}
        <span className={styles.string}>"userId"</span>
        <span
          className={`${styles.fixableCode} ${isErrorFixed(1) ? styles.isFixed : ""}`}
        >
          <span className={styles.broken}></span>
          <span className={styles.fixed}>
            ,{"\n"}
            {"    "}
            <span className={styles.field}>foreignField</span>:{" "}
            <span className={styles.string}>"_id"</span>,{"\n"}
            {"    "}
            <span className={styles.field}>as</span>:{" "}
            <span className={styles.string}>"user"</span>
          </span>
        </span>
        {"\n"}
        {"  "}
        {"})"}
        <span
          className={`${styles.codeCursor} ${activeCursor === 1 ? styles.visible : ""}`}
        ></span>
        {"\n"}
        {"  "}.<span className={styles.keyword}>match</span>({"{"}{" "}
        <span className={styles.field}>total</span>: {"{"}{" "}
        <span className={styles.operator}>$gt</span>:{" "}
        <span
          className={`${styles.fixableCode} ${isErrorFixed(2) ? styles.isFixed : ""}`}
        >
          {isErrorFixed(2) ?
            <span className={styles.broken}>"100"</span>
          : <TypeTooltip
              content={
                <ErrorTooltipContent
                  message="Type 'string' not assignable to 'number'"
                  detail="$gt on number field requires number"
                />
              }
            >
              <span
                className={`${styles.broken} ${styles.errorUnderline} ${activeUnderlines.has(2) ? styles.active : ""}`}
              >
                "100"
              </span>
            </TypeTooltip>
          }
          <span className={`${styles.fixed} ${styles.field}`}>100</span>
        </span>
        <span
          className={`${styles.codeCursor} ${activeCursor === 2 ? styles.visible : ""}`}
        ></span>{" "}
        {"}"} {"})"}){"\n"}
        {"  "}.<span className={styles.keyword}>set</span>({"{"}
        {"\n"}
        {"    "}
        <span className={styles.field}>orderTotalWithTax</span>: {"{"}{" "}
        <span className={styles.operator}>$multiply</span>: [
        <span
          className={`${styles.fixableCode} ${isErrorFixed(3) ? styles.isFixed : ""}`}
        >
          {isErrorFixed(3) ?
            <span className={styles.broken}>"$totl"</span>
          : <TypeTooltip
              content={
                <ErrorTooltipContent
                  message='"$totl" does not exist on Order'
                  detail='Did you mean "$total"?'
                />
              }
            >
              <span
                className={`${styles.broken} ${styles.errorUnderline} ${activeUnderlines.has(3) ? styles.active : ""}`}
              >
                "$totl"
              </span>
            </TypeTooltip>
          }
          <span className={`${styles.fixed} ${styles.string}`}>"$total"</span>
        </span>
        <span
          className={`${styles.codeCursor} ${activeCursor === 3 ? styles.visible : ""}`}
        ></span>
        , <span className={styles.field}>1.2</span>] {"}"},{"\n"}
        {"    "}
        <span className={styles.field}>fullName</span>: {"{"}{" "}
        <span className={styles.operator}>$concat</span>: [{"\n"}
        {"      "}
        <span className={styles.string}>"$firstName"</span>,{"\n"}
        {"      "}
        <span
          className={`${styles.fixableCode} ${isErrorFixed(4) ? styles.isFixed : ""}`}
        >
          {isErrorFixed(4) ?
            <span className={styles.broken}>123</span>
          : <TypeTooltip
              content={
                <ErrorTooltipContent
                  message="Type 'number' not assignable to 'string'"
                  detail="$concat operands must be strings"
                />
              }
            >
              <span
                className={`${styles.broken} ${styles.errorUnderline} ${activeUnderlines.has(4) ? styles.active : ""}`}
              >
                123
              </span>
            </TypeTooltip>
          }
          <span className={styles.fixed}>
            <span className={styles.string}>" "</span>,{"\n"}
            {"      "}
            <span className={styles.string}>"$lastName"</span>
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
        {"  "}.<span className={styles.keyword}>project</span>({"{"}{" "}
        <span className={styles.field}>orderTotalWithTax</span>:{" "}
        <span className={styles.field}>1</span>,{" "}
        <span className={styles.field}>fullName</span>:{" "}
        <span className={styles.field}>1</span> {"}"})
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
