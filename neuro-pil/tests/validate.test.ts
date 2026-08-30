import { describe, it, expect } from "vitest";
import { defineDag } from "../dag";
import { validate, sliceParity } from "../validate";

function cleanDag() {
  return defineDag([
    { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
    { key: "note", label: "Note", kind: "source", inputs: [], basis: "", note: true },
    { key: "b", label: "B", kind: "derived", inputs: ["a"], basis: "" },
    { key: "noteSink", label: "Note Sink", kind: "leaf", inputs: ["b", "note"], basis: "", noteSink: true },
  ]);
}

describe("validate — clean graph", () => {
  it("returns no findings", () => {
    expect(validate(cleanDag())).toEqual([]);
  });
});

describe("validate — unknown-input", () => {
  it("flags a node whose inputs reference a key that doesn't exist", () => {
    const dag = defineDag([{ key: "a", label: "A", kind: "leaf", inputs: ["ghost"], basis: "" }]);
    expect(validate(dag)).toContainEqual(expect.objectContaining({ rule: "unknown-input", node: "a" }));
  });
});

describe("validate — duplicate-key", () => {
  it("flags a repeated node key", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
      { key: "a", label: "A again", kind: "source", inputs: [], basis: "" },
    ]);
    expect(validate(dag)).toContainEqual(expect.objectContaining({ rule: "duplicate-key", node: "a" }));
  });
});

describe("validate — source-has-inputs", () => {
  it("flags a source node that declares inputs", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
      { key: "b", label: "B", kind: "source", inputs: ["a"], basis: "" },
    ]);
    expect(validate(dag)).toContainEqual(expect.objectContaining({ rule: "source-has-inputs", node: "b" }));
  });
});

describe("validate — cycle", () => {
  it("reports the actual cycle path", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "derived", inputs: ["b"], basis: "" },
      { key: "b", label: "B", kind: "derived", inputs: ["a"], basis: "" },
    ]);
    const findings = validate(dag).filter((f) => f.rule === "cycle");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].message).toContain("a -> b -> a");
  });
});

describe("validate — orphan", () => {
  it("flags a source node consumed by nothing", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
      { key: "b", label: "B", kind: "source", inputs: [], basis: "" },
      { key: "c", label: "C", kind: "derived", inputs: ["a"], basis: "" },
    ]);
    // `a` feeds `c`; `b` is collected but nothing ever reads it — orphan.
    expect(validate(dag)).toContainEqual(expect.objectContaining({ rule: "orphan", node: "b" }));
  });

  it("does not flag derived/leaf/projection nodes for being terminal — that's their normal case", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
      { key: "derived", label: "Derived", kind: "derived", inputs: ["a"], basis: "" },
      { key: "leaf", label: "Leaf", kind: "leaf", inputs: ["a"], basis: "" },
      { key: "proj", label: "Proj", kind: "projection", inputs: ["a"], basis: "" },
    ]);
    expect(validate(dag).filter((f) => f.rule === "orphan")).toEqual([]);
  });

  it("respects the terminalAllowlist", () => {
    const dag = defineDag([
      { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
      { key: "b", label: "B", kind: "source", inputs: [], basis: "" },
      { key: "c", label: "C", kind: "derived", inputs: ["a"], basis: "" },
    ]);
    expect(validate(dag, { terminalAllowlist: ["b"] }).filter((f) => f.rule === "orphan")).toEqual([]);
  });
});

describe("validate — note-feeds-non-sink", () => {
  it("flags a note consumed by a node that isn't a noteSink", () => {
    const dag = defineDag([
      { key: "note", label: "Note", kind: "source", inputs: [], basis: "", note: true },
      { key: "core", label: "Core", kind: "derived", inputs: ["note"], basis: "" },
    ]);
    expect(validate(dag)).toContainEqual(expect.objectContaining({ rule: "note-feeds-non-sink", node: "core" }));
  });

  it("does not flag a declared noteSink", () => {
    const dag = defineDag([
      { key: "note", label: "Note", kind: "source", inputs: [], basis: "", note: true },
      { key: "sink", label: "Sink", kind: "leaf", inputs: ["note"], basis: "", noteSink: true },
    ]);
    expect(validate(dag).filter((f) => f.rule === "note-feeds-non-sink")).toEqual([]);
  });
});

describe("sliceParity", () => {
  const dag = defineDag([
    { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
    { key: "b", label: "B", kind: "source", inputs: [], basis: "" },
  ]);

  it("returns no findings when slices exactly cover the source keys", () => {
    expect(sliceParity(dag, { a: () => 1, b: () => 2 })).toEqual([]);
  });

  it("flags a source with no matching slice", () => {
    expect(sliceParity(dag, { a: () => 1 })).toContainEqual(expect.objectContaining({ rule: "missing-slice", node: "b" }));
  });

  it("flags a slice with no matching source", () => {
    expect(sliceParity(dag, { a: () => 1, b: () => 2, ghost: () => 3 })).toContainEqual(
      expect.objectContaining({ rule: "missing-slice", node: "ghost" }),
    );
  });
});
