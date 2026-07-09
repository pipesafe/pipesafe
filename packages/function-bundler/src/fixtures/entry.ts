import { half } from "./helper";

export default function halfPlusOne(value: number): number {
  return half(value) + 1;
}

export const named = (value: number): number => half(value) * 10;
