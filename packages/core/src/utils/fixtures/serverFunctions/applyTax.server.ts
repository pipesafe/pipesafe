import { round } from "./round";

/**
 * Test fixture: a file-based $function body with an import — bundled by
 * @pipesafe/function-bundler into a self-contained script.
 */
export default function applyTax(price: number): number {
  return round(price * 1.2);
}

export function double(price: number): number {
  return price * 2;
}
