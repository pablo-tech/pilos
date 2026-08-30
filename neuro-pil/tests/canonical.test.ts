import { describe, it, expect } from "vitest";
import { defineDag } from "../dag";
import { stableStringify, canonicalFor, canonicalMap, driftedKeys } from "../canonical";

describe("stableStringify", () => {
  it("sorts object keys regardless of insertion order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("drops undefined values rather than emitting null", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("recurses into arrays and nested objects", () => {
    expect(stableStringify({ a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}]}');
  });
});

function sampleDag() {
  return defineDag([
    { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
    { key: "b", label: "B", kind: "source", inputs: [], basis: "" },
    { key: "core", label: "Core", kind: "derived", inputs: ["a", "b"], basis: "" },
    { key: "proj", label: "Projection", kind: "projection", inputs: ["a"], basis: "" },
  ]);
}

type Subject = { a: string; b: string };

describe("canonicalFor / canonicalMap / driftedKeys", () => {
  const dag = sampleDag();
  const slices = { a: (s: Subject) => s.a, b: (s: Subject) => s.b };

  it("canonicalFor hashes exactly the source closure of the requested node", () => {
    expect(canonicalFor(dag, { a: "1", b: "2" }, slices, "core")).toBe('{"a":"1","b":"2"}');
    expect(canonicalFor(dag, { a: "1", b: "2" }, slices, "a")).toBe('{"a":"1"}');
  });

  it("an unknown slice key contributes nothing rather than throwing", () => {
    expect(canonicalFor(dag, { a: "1", b: "2" }, { a: slices.a }, "core")).toBe('{"a":"1"}');
  });

  it("canonicalMap covers every non-projection node and skips projections", () => {
    const map = canonicalMap(dag, { a: "1", b: "2" }, slices);
    expect(Object.keys(map).sort()).toEqual(["a", "b", "core"]);
  });

  it("driftedKeys reports keys whose canonical string changed, including newly-added ones", () => {
    const before = canonicalMap(dag, { a: "1", b: "2" }, slices);
    const after = canonicalMap(dag, { a: "1", b: "3" }, slices);
    expect(driftedKeys(after, before)).toEqual(["b", "core"]);
    expect(driftedKeys(after, { a: before.a })).toEqual(expect.arrayContaining(["b", "core"]));
  });
});
