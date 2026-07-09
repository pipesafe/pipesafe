import { round } from "./mathUtils";

/**
 * A file-based $function body: lives in its own module so it MAY import
 * helpers. At pipeline-build time `@pipesafe/function-bundler` bundles this
 * module — imports included — into one self-contained script for the
 * MongoDB server.
 */
export default function applyTax(price: number): number {
  return round(price * 1.2);
}
