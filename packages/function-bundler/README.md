# @pipesafe/function-bundler

Optional companion to [`@pipesafe/core`](https://www.npmjs.com/package/@pipesafe/core) that bundles **file-based `$function` bodies** — imports included — into self-contained scripts for MongoDB server-side execution.

Inline `$function` bodies must be self-contained (MongoDB executes them in an isolated JS engine, so closures and imports cannot be serialized). When a body needs helpers, author it in its own module and reference it with `serverFn()`:

```ts
// pricing.server.ts
import { round } from "./mathUtils";
export default function applyTax(price: number): number {
  return round(price * 1.2);
}
```

```ts
import { serverFn } from "@pipesafe/core";
import applyTax from "./pricing.server";

pipeline.set({
  taxed: {
    $function: {
      body: serverFn(applyTax, import.meta.resolve("./pricing.server.ts")),
      args: ["$price"],
      lang: "js",
    },
  },
});
```

At pipeline-build time, `@pipesafe/core` lazily loads this package and bundles the module (esbuild: TypeScript parsed natively, tree-shaken, imports inlined) into a single function string. If you only write inline bodies, you don't need this package.

## License

Apache 2.0
