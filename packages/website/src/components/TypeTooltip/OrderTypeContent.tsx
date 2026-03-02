import styles from "./TypeTooltip.module.css";

interface Property {
  name: string;
  type: string;
}

interface OrderTypeContentProps {
  declaration?: string;
  typeName?: string;
  properties?: Property[];
}

const ORDER_PROPERTIES: Property[] = [
  { name: "_id", type: "ObjectId" },
  { name: "userId", type: "ObjectId" },
  { name: "total", type: "number" },
  {
    name: "items",
    type: "{ productId: string; name: string; quantity: number; price: number }[]",
  },
  { name: "createdAt", type: "Date" },
];

export default function OrderTypeContent({
  declaration,
  typeName = "Order",
  properties,
}: OrderTypeContentProps) {
  const props = properties ?? ORDER_PROPERTIES;

  return (
    <>
      {declaration ?
        <>
          <span className={styles.typeKeyword}>const</span>{" "}
          <span className={styles.property}>{declaration}</span>
          <span className={styles.punctuation}>:</span>{" "}
        </>
      : <>
          <span className={styles.typeKeyword}>type</span>{" "}
          <span className={styles.typeName}>{typeName}</span>{" "}
          <span className={styles.punctuation}>=</span>{" "}
        </>
      }
      <span className={styles.punctuation}>{"{"}</span>
      {props.map((prop) => (
        <span key={prop.name}>
          {"\n"}
          {"  "}
          <span className={styles.property}>{prop.name}</span>
          <span className={styles.punctuation}>:</span>{" "}
          <span className={styles.propertyType}>{prop.type}</span>
          <span className={styles.punctuation}>;</span>
        </span>
      ))}
      {"\n"}
      <span className={styles.punctuation}>{"}"}</span>
    </>
  );
}
