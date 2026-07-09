import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  serializeFunctionBody,
  serializeFunctionBodies,
  serverFn,
} from "./serializeFunction";
import { Pipeline } from "../pipeline/Pipeline";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import applyTax from "./fixtures/serverFunctions/applyTax.server";

// ============================================================================
// serializeFunctionBody — purity enforcement
// ============================================================================

describe("serializeFunctionBody", () => {
  it("serializes a pure arrow function to its source", () => {
    const src = serializeFunctionBody((a: number) => a * 2);
    expect(src).toContain("=>");
    expect(src).toContain("a * 2");
  });

  it("serializes a pure function expression", () => {
    const src = serializeFunctionBody(function namedFn(a: number) {
      return a + 1;
    });
    expect(src).toContain("function");
    expect(src).toContain("a + 1");
  });

  it("throws on a closure over an outer variable, naming it", () => {
    const TAX = 1.2;
    expect(() => serializeFunctionBody((p: number) => p * TAX)).toThrow(
      /'TAX'/
    );
  });

  it("names every free identifier, sorted", () => {
    const alpha = 1;
    const beta = 2;
    expect(() => serializeFunctionBody(() => beta + alpha)).toThrow(
      /'alpha', 'beta'/
    );
  });

  it("allows MongoDB server-side globals", () => {
    expect(() =>
      serializeFunctionBody((d: string) => {
        const parsed: unknown = JSON.parse(d);
        const when = new Date();
        return Math.floor(when.getTime()) + String(parsed) + parseInt("42", 10);
      })
    ).not.toThrow();
  });

  it("rejects console — not available in the server's JS engine", () => {
    expect(() =>
      serializeFunctionBody((a: number) => {
        console.log(a);
        return a;
      })
    ).toThrow(/'console'/);
  });

  it("only counts the leading object of a property chain", () => {
    expect(() =>
      serializeFunctionBody((o: { a: { b: number } }) => o.a.b)
    ).not.toThrow();
  });

  it("counts shorthand object properties as references", () => {
    expect(() => serializeFunctionBody(() => ({ shorthandRef }))).toThrow(
      /'shorthandRef'/
    );
    expect(() =>
      serializeFunctionBody(() => {
        const a = 1;
        return { a };
      })
    ).not.toThrow();
  });

  it("counts computed keys as references", () => {
    expect(() => serializeFunctionBody(() => ({ [missingKey]: 1 }))).toThrow(
      /'missingKey'/
    );
    expect(() =>
      serializeFunctionBody((k: string) => ({ [k]: 1 }))
    ).not.toThrow();
  });

  it("binds catch params, destructured params, and defaults", () => {
    expect(() =>
      serializeFunctionBody(
        (
          { a, b: { c } }: { a: number; b: { c: number } },
          [d]: number[],
          e = 5
        ) => {
          try {
            return a + c + (d ?? 0) + e;
          } catch (err) {
            return String(err).length;
          }
        }
      )
    ).not.toThrow();
  });

  it("handles var/function hoisting (use before declaration)", () => {
    expect(() =>
      serializeFunctionBody((x: number) => {
        const y = helper(x);
        function helper(n: number): number {
          return n + offset;
        }
        var offset = 1;
        return y;
      })
    ).not.toThrow();
  });

  it("binds loop variables, labels, classes, and inner function names", () => {
    expect(() =>
      serializeFunctionBody((n: number) => {
        class Acc {
          total = 0;
          add(v: number): void {
            this.total += v;
          }
        }
        const acc = new Acc();
        outer: for (let i = 0; i < n; i++) {
          for (const v of [1, 2, 3]) {
            if (v > 2) continue outer;
            acc.add(v);
          }
        }
        return `total: ${acc.total}`;
      })
    ).not.toThrow();
  });

  it("catches free variables inside nested functions", () => {
    expect(() =>
      serializeFunctionBody((xs: number[]) => xs.map((x) => x * factor))
    ).toThrow(/'factor'/);
  });

  it("throws on native functions", () => {
    expect(() => serializeFunctionBody(Math.floor)).toThrow(/native or bound/);
  });

  it("throws on bound functions", () => {
    function f(a: number): number {
      return a;
    }
    expect(() => serializeFunctionBody(f.bind(null))).toThrow(
      /native or bound/
    );
  });

  it("does not mistake a body containing '[native code]' text for a native function", () => {
    expect(() =>
      serializeFunctionBody((s: string) => s.replace("[native code]", ""))
    ).not.toThrow();
    const src = serializeFunctionBody((x: string) =>
      x === "[native code]" ? 0 : 1
    );
    expect(src).toContain("[native code]");
    // Even the full braced form inside a string literal is fine — the guard
    // is anchored to the WHOLE source, not a substring.
    expect(() =>
      serializeFunctionBody((s: string) => s.includes("{ [native code] }"))
    ).not.toThrow();
  });

  it("rejects a function declaration escaping its block (strict scoping, no Annex-B hoisting)", () => {
    const blockFn = new Function(
      "return ((a) => { { function g() { return a; } } return g(); })"
    ) as () => (a: number) => unknown;
    expect(() => serializeFunctionBody(blockFn())).toThrow(/'g'/);
  });

  it("accepts a default parameter referencing a later parameter", () => {
    const paramDefault = new Function("return ((a = b, b) => a + b)") as () => (
      a: number,
      b: number
    ) => number;
    expect(() => serializeFunctionBody(paramDefault())).not.toThrow();
  });

  it("rejects nested async functions and dynamic import", () => {
    expect(() =>
      serializeFunctionBody((a: number) => {
        async function h(): Promise<number> {
          return a;
        }
        return h;
      })
    ).toThrow(/async/);
    const dynImport = new Function(
      "return ((x) => import('mod') || x)"
    ) as () => (x: unknown) => unknown;
    expect(() => serializeFunctionBody(dynImport())).toThrow(/import/);
  });

  it("throws on async functions", () => {
    expect(() => serializeFunctionBody(async (a: number) => a)).toThrow(
      /async/
    );
  });

  it("throws on generator functions", () => {
    expect(() =>
      serializeFunctionBody(function* gen() {
        yield 1;
      })
    ).toThrow(/generator/);
  });

  it("binds switch-case lexical declarations (shared case scope)", () => {
    expect(() =>
      serializeFunctionBody((x: number) => {
        switch (x) {
          case 1: {
            const inBlock = 2;
            return inBlock;
          }
          default:
            return 0;
        }
      })
    ).not.toThrow();
    // Bare (unbraced) case-level const/let share the switch's single
    // lexical scope — visible from other cases. Built via the Function
    // constructor because our own lint (correctly) discourages bare
    // case declarations in source.
    const bare = new Function(
      "x",
      "switch (x) { case 1: const y = 2; return y; case 2: return y; default: return 0; }"
    ) as (x: number) => number;
    expect(() => serializeFunctionBody(bare)).not.toThrow();
  });

  it("binds a named function expression's self-reference", () => {
    expect(() =>
      serializeFunctionBody(function fib(n: number): number {
        return n < 2 ? n : fib(n - 1) + fib(n - 2);
      })
    ).not.toThrow();
  });

  it("recovers shorthand-method sources", () => {
    const obj = {
      calc(a: number): number {
        return a * 2;
      },
    };
    const src = serializeFunctionBody(obj.calc);
    expect(src).toContain("a * 2");
  });
});

// Free identifiers used by the negative tests above — declared so the file
// itself typechecks. They are module-scope, hence "outer scope" at runtime.
declare const shorthandRef: number;
declare const missingKey: string;
declare const factor: number;

// ============================================================================
// serializeFunctionBodies — stage walking
// ============================================================================

describe("serializeFunctionBodies", () => {
  it("preserves Dates, RegExps, ObjectIds, and null", () => {
    const when = new Date();
    const id = new ObjectId();
    const pattern = /abc/i;
    const [stage] = serializeFunctionBodies([
      { $match: { when, id, pattern, missing: null } },
    ]);
    expect(stage?.["$match"].when).toBe(when);
    expect(stage?.["$match"].id).toBe(id);
    expect(stage?.["$match"].pattern).toBe(pattern);
    expect(stage?.["$match"].missing).toBeNull();
  });

  it("returns $function-free stages by reference (no deep clone)", () => {
    const stage = { $match: { age: { $gte: 3 } }, nested: { a: [1, 2, 3] } };
    const [out] = serializeFunctionBodies([stage]);
    expect(out).toBe(stage);
  });

  it("does not inject a phantom body into a $function object without one", () => {
    const [stage] = serializeFunctionBodies([
      { $set: { x: { $function: { args: ["$age"], lang: "js" } } } },
    ]);
    const spec = stage?.["$set"].x.$function as Record<string, unknown>;
    expect("body" in spec).toBe(false);
  });

  it("serializes $function bodies nested in arrays and objects", () => {
    const [stage] = serializeFunctionBodies([
      {
        $set: {
          total: {
            $add: [
              1,
              {
                $function: {
                  body: (a: number) => a * 3,
                  args: ["$age"],
                  lang: "js",
                },
              },
            ],
          },
        },
      },
    ]);
    const fnSpec = stage?.["$set"].total.$add[1].$function;
    expect(typeof fnSpec.body).toBe("string");
    expect(fnSpec.body).toContain("a * 3");
    expect(fnSpec.args).toEqual(["$age"]);
    expect(fnSpec.lang).toBe("js");
  });

  it("serializes $function nested in another $function's args", () => {
    const [stage] = serializeFunctionBodies([
      {
        $set: {
          chained: {
            $function: {
              body: (x: number) => x + 1,
              args: [{ $function: { body: () => 5, args: [], lang: "js" } }],
              lang: "js",
            },
          },
        },
      },
    ]);
    const outer = stage?.["$set"].chained.$function;
    expect(typeof outer.body).toBe("string");
    expect(typeof outer.args[0].$function.body).toBe("string");
  });

  it("returns stages without $function untouched in value", () => {
    const stages = [{ $match: { age: { $gte: 3 } } }, { $limit: 5 }];
    expect(serializeFunctionBodies(stages)).toEqual(stages);
  });
});

// ============================================================================
// Pipeline integration
// ============================================================================

type Person = { name: string; age: number };

describe("Pipeline $function integration", () => {
  it("emits a string body via .set()", () => {
    const stages = new Pipeline<Person>()
      .set({
        doubled: {
          $function: { body: (a: number) => a * 2, args: ["$age"], lang: "js" },
        },
      })
      .getPipeline();
    const fnSpec = stages[0]?.["$set"].doubled.$function;
    expect(typeof fnSpec.body).toBe("string");
    expect(fnSpec.body).toContain("a * 2");
  });

  it("serializes $function inside custom() stages", () => {
    const stages = new Pipeline<Person>()
      .custom<Person & { tripled: number }>([
        {
          $set: {
            tripled: {
              $function: {
                body: (a: number) => a * 3,
                args: ["$age"],
                lang: "js",
              },
            },
          },
        },
      ])
      .getPipeline();
    expect(typeof stages[0]?.["$set"].tripled.$function.body).toBe("string");
  });

  it("throws at stage-add time for impure bodies", () => {
    const limit = 10;
    expect(() =>
      new Pipeline<Person>().set({
        capped: {
          $function: {
            body: (a: number) => Math.min(a, limit),
            args: ["$age"],
            lang: "js",
          },
        },
      })
    ).toThrow(/'limit'/);
  });

  it("bundles file-based serverFn bodies with their imports", () => {
    const ref = serverFn(
      applyTax,
      new URL("./fixtures/serverFunctions/applyTax.server.ts", import.meta.url)
    );
    const stages = new Pipeline<{ price: number }>()
      .set({
        taxed: { $function: { body: ref, args: ["$price"], lang: "js" } },
      })
      .getPipeline();

    const body = stages[0]?.["$set"].taxed.$function.body as string;
    expect(typeof body).toBe("string");
    // self-contained: no module syntax left
    expect(body).not.toMatch(/^\s*import /m);
    expect(body).not.toContain("require(");
    // the imported helper was inlined
    expect(body).toContain("Math.round");

    // round-trip: the bundled body is directly executable
    const fn = new Function(`return (${body})`)() as (p: number) => number;
    expect(fn(10)).toBeCloseTo(12);
  });

  it("rebundles a serverFn body when the source file's content changes", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "pipesafe-serverfn-"));
    const modulePath = join(dir, "body.server.ts");
    try {
      writeFileSync(modulePath, "export default (p: number) => p + 1;\n");
      const ref = serverFn((p: number) => p, modulePath);

      const build = (): string =>
        new Pipeline<{ price: number }>()
          .set({
            v: { $function: { body: ref, args: ["$price"], lang: "js" } },
          })
          .getPipeline()[0]?.["$set"].v.$function.body as string;

      const first = build();
      const run = (body: string): ((p: number) => number) =>
        new Function(`return (${body})`)() as (p: number) => number;
      expect(run(first)(10)).toBe(11);

      // Edit the module — same url, same export, new content. The cache is
      // content-hash validated, so the next build must pick this up.
      writeFileSync(modulePath, "export default (p: number) => p + 2;\n");
      const second = build();
      expect(run(second)(10)).toBe(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports named exports in serverFn", () => {
    const ref = serverFn(
      applyTax, // typing only; exportName selects the actual function
      new URL("./fixtures/serverFunctions/applyTax.server.ts", import.meta.url),
      "double"
    );
    const stages = new Pipeline<{ price: number }>()
      .set({ x: { $function: { body: ref, args: ["$price"], lang: "js" } } })
      .getPipeline();
    const body = stages[0]?.["$set"].x.$function.body as string;
    const fn = new Function(`return (${body})`)() as (p: number) => number;
    expect(fn(10)).toBe(20);
  });
});

// ============================================================================
// End-to-end against real MongoDB
// ============================================================================

describe("$function e2e", async () => {
  const { client } = await useMemoryMongo();

  it("executes a $function pipeline against MongoDB", async () => {
    const db = client.db();
    await db
      .collection("people")
      .insertMany([
        { name: "ada", age: 2 } satisfies Person,
        { name: "bob", age: 3 } satisfies Person,
      ]);

    const pipeline = new Pipeline<Person>({
      client,
      collectionName: "people",
    }).set({
      doubled: {
        $function: { body: (a: number) => a * 2, args: ["$age"], lang: "js" },
      },
    });

    let docs: (Person & { doubled: number })[];
    try {
      docs = await pipeline.execute().toArray();
    } catch (error) {
      // Some mongod builds ship with server-side scripting disabled — fall
      // back to asserting the emitted pipeline shape.
      if (!/javascript|scripting|\$function/i.test(String(error))) throw error;
      const fnSpec = pipeline.getPipeline()[0]?.["$set"].doubled.$function;
      expect(typeof fnSpec.body).toBe("string");
      expect(fnSpec.args).toEqual(["$age"]);
      return;
    }
    expect(docs.map((d) => d.doubled).sort((a, b) => a - b)).toEqual([4, 6]);
  });

  it("executes a bundled serverFn body against MongoDB", async () => {
    const db = client.db();
    await db.collection("items").insertMany([{ price: 10 }, { price: 20 }]);

    const ref = serverFn(
      applyTax,
      new URL("./fixtures/serverFunctions/applyTax.server.ts", import.meta.url)
    );
    const pipeline = new Pipeline<{ price: number }>({
      client,
      collectionName: "items",
    }).set({
      taxed: { $function: { body: ref, args: ["$price"], lang: "js" } },
    });

    let docs: { taxed: number }[];
    try {
      docs = await pipeline.execute().toArray();
    } catch (error) {
      if (!/javascript|scripting|\$function/i.test(String(error))) throw error;
      return;
    }
    expect(docs.map((d) => d.taxed).sort((a, b) => a - b)).toEqual([12, 24]);
  });
});
