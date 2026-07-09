import { describe, expect, it } from "vitest";
import { bundleServerFunction } from "./index";

const fixtureUrl = (name: string): string =>
  new URL(`./fixtures/${name}`, import.meta.url).href;

describe("bundleServerFunction", () => {
  it("bundles a TS module with a relative import into a self-contained function", () => {
    const body = bundleServerFunction({
      url: fixtureUrl("entry.ts"),
      exportName: "default",
    });

    expect(body).not.toMatch(/^\s*import /m);
    expect(body).not.toContain("require(");

    const fn = new Function(`return (${body})`)() as (v: number) => number;
    expect(fn(8)).toBe(5); // half(8) + 1
  });

  it("supports named exports", () => {
    const body = bundleServerFunction({
      url: fixtureUrl("entry.ts"),
      exportName: "named",
    });
    const fn = new Function(`return (${body})`)() as (v: number) => number;
    expect(fn(8)).toBe(40); // half(8) * 10
  });

  it("resolves the default export of a CommonJS module (module.exports = fn)", () => {
    const body = bundleServerFunction({
      url: fixtureUrl("cjsDefault.cjs"),
      exportName: "default",
    });
    const fn = new Function(`return (${body})`)() as (v: number) => number;
    expect(fn(4)).toBe(12); // triple(4)
  });

  it("throws a clear error for a missing export at execution", () => {
    const body = bundleServerFunction({
      url: fixtureUrl("entry.ts"),
      exportName: "doesNotExist",
    });
    const fn = new Function(`return (${body})`)() as (v: number) => number;
    expect(() => fn(1)).toThrow(/doesNotExist/);
  });

  it("fails loudly on unresolvable imports", () => {
    expect(() =>
      bundleServerFunction({
        url: fixtureUrl("badImport.ts"),
        exportName: "default",
      })
    ).toThrow(/this-package-does-not-exist-pipesafe/);
  });
});
