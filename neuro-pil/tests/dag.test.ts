import { describe, it, expect } from "vitest";
import { defineDag, isStamped } from "../dag";

function sampleDag() {
  return defineDag([
    { key: "a", label: "A", kind: "source", inputs: [], basis: "raw a" },
    { key: "b", label: "B", kind: "source", inputs: [], basis: "raw b" },
    { key: "note", label: "Note", kind: "source", inputs: [], basis: "commentary", note: true },
    { key: "noteResult", label: "Note Result", kind: "leaf", inputs: ["a", "note"], basis: "derived from a + note", noteSink: true },
    { key: "core", label: "Core", kind: "derived", inputs: ["a", "b"], basis: "derived from a + b" },
    { key: "leaf1", label: "Leaf 1", kind: "leaf", inputs: ["core"], basis: "derived from core" },
    { key: "proj", label: "Projection", kind: "projection", inputs: ["core", "b"], basis: "self-hashed projection" },
  ]);
}

describe("defineDag", () => {
  it("dagNode looks a node up by key, undefined for unknown", () => {
    const dag = sampleDag();
    expect(dag.dagNode("core")?.kind).toBe("derived");
    expect(dag.dagNode("nope")).toBeUndefined();
  });

  it("upstreamOf is the transitive closure of inputs", () => {
    const dag = sampleDag();
    expect(dag.upstreamOf("leaf1")).toEqual(new Set(["core", "a", "b"]));
    expect(dag.upstreamOf("a")).toEqual(new Set());
  });

  it("downstreamOf is the transitive closure of dependents", () => {
    const dag = sampleDag();
    expect(dag.downstreamOf("a")).toEqual(new Set(["noteResult", "core", "leaf1", "proj"]));
    expect(dag.downstreamOf("leaf1")).toEqual(new Set());
  });

  it("upstream/downstream are inverse across an edge", () => {
    const dag = sampleDag();
    expect(dag.upstreamOf("core")).toContain("a");
    expect(dag.downstreamOf("a")).toContain("core");
  });

  it("sourceClosureOf returns only source-kind keys, sorted, including self if a source", () => {
    const dag = sampleDag();
    expect(dag.sourceClosureOf("a")).toEqual(["a"]);
    expect(dag.sourceClosureOf("leaf1")).toEqual(["a", "b"]);
    expect(dag.sourceClosureOf("proj")).toEqual(["a", "b"]);
  });

  it("isStamped is false only for projection nodes", () => {
    const dag = sampleDag();
    for (const n of dag.nodes) expect(isStamped(n)).toBe(n.kind !== "projection");
  });
});
