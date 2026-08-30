import { describe, it, expect } from "vitest";
import { defineDag } from "../dag";
import { renderMermaid, extractDagBlock, writeDagBlock, DEFAULT_MERMAID_MARKERS } from "../mermaid";

function sampleDag() {
  return defineDag([
    { key: "a", label: "A", kind: "source", inputs: [], basis: "" },
    { key: "b", label: "B", kind: "derived", inputs: ["a"], basis: "" },
  ]);
}

describe("renderMermaid", () => {
  it("emits one node line per node and one edge line per input, keyed off key+label only", () => {
    expect(renderMermaid(sampleDag())).toBe('graph LR\n  a["A"]\n  b["B"]\n  a --> b');
  });
});

describe("extractDagBlock", () => {
  it("returns the fenced mermaid body between the markers", () => {
    const doc = "before\n<!-- DAG:START -->\n\n```mermaid\ngraph LR\n  a[\"A\"]\n```\n\n<!-- DAG:END -->\nafter";
    expect(extractDagBlock(doc)).toBe('graph LR\n  a["A"]');
  });

  it("returns null when the markers are missing", () => {
    expect(extractDagBlock("no markers here")).toBeNull();
  });

  it("supports custom markers", () => {
    const doc = "<<S>>\n```mermaid\nx\n```\n<<E>>";
    expect(extractDagBlock(doc, { start: "<<S>>", end: "<<E>>" })).toBe("x");
  });
});

describe("writeDagBlock", () => {
  it("rewrites the block between the markers to the current render output", () => {
    const doc = `before\n${DEFAULT_MERMAID_MARKERS.start}\n\n\`\`\`mermaid\nSTALE\n\`\`\`\n\n${DEFAULT_MERMAID_MARKERS.end}\nafter`;
    const next = writeDagBlock(doc, sampleDag());
    expect(extractDagBlock(next)).toBe(renderMermaid(sampleDag()));
    expect(next.startsWith("before\n")).toBe(true);
    expect(next.endsWith("\nafter")).toBe(true);
  });

  it("throws if the markers are not present, rather than silently no-op'ing", () => {
    expect(() => writeDagBlock("no markers", sampleDag())).toThrow();
  });
});
