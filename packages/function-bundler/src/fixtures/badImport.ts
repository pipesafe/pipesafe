// @ts-expect-error intentionally unresolvable — exercises esbuild's error path
import { nothing } from "this-package-does-not-exist-pipesafe";

export default function broken(value: number): number {
  return (nothing as number) + value;
}
