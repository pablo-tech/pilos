import { describe, it, expect } from "vitest";
import { extractFrontmatter, parseFrontmatterBlock, parseVaultNode, dagFromFiles } from "../markdown";

describe("extractFrontmatter", () => {
  it("returns the block between --- delimiters", () => {
    const text = "---\nnode: a\nkind: source\n---\n\n# Body\ncontent here";
    expect(extractFrontmatter(text)).toBe("node: a\nkind: source");
  });

  it("returns null when there are no delimiters", () => {
    expect(extractFrontmatter("just a plain markdown file")).toBeNull();
  });
});

describe("parseFrontmatterBlock", () => {
  it("parses flat scalars, quoted strings, and booleans", () => {
    expect(parseFrontmatterBlock('node: forecast/WEEKEND\nkind: derived\nnote: true\nbasis: "Weekend forecast"')).toEqual({
      node: "forecast/WEEKEND",
      kind: "derived",
      note: true,
      basis: "Weekend forecast",
    });
  });

  it("parses a flow list", () => {
    expect(parseFrontmatterBlock("inputs: [a, b, c]")).toEqual({ inputs: ["a", "b", "c"] });
  });

  it("parses a block list", () => {
    const block = "inputs:\n  - a\n  - b\n  - c";
    expect(parseFrontmatterBlock(block)).toEqual({ inputs: ["a", "b", "c"] });
  });

  it("parses an empty flow list", () => {
    expect(parseFrontmatterBlock("inputs: []")).toEqual({ inputs: [] });
  });
});

describe("parseVaultNode", () => {
  it("parses a markdown file's frontmatter into a node descriptor", () => {
    const text = [
      "---",
      "node: forecast/WEEKEND",
      "kind: derived",
      "inputs: [station/BUOY, station/INLAND, station/COASTAL]",
      'basis: "Weekend forecast written across the station readings."',
      "---",
      "",
      "# Weekend forecast",
      "body content",
    ].join("\n");
    expect(parseVaultNode(text)).toEqual({
      node: "forecast/WEEKEND",
      kind: "derived",
      label: undefined,
      inputs: ["station/BUOY", "station/INLAND", "station/COASTAL"],
      basis: "Weekend forecast written across the station readings.",
      note: false,
      noteSink: false,
    });
  });

  it("parses a bare .neuro-pil.yml folder manifest with no --- delimiters", () => {
    const text = 'kind: source\nnode: station/BUOY\nlabel: Offshore buoy';
    expect(parseVaultNode(text)).toEqual({
      node: "station/BUOY",
      kind: "source",
      label: "Offshore buoy",
      inputs: [],
      basis: "",
      note: false,
      noteSink: false,
    });
  });

  it("returns null for a file with no frontmatter", () => {
    expect(parseVaultNode("# Just a heading\n\nSome prose.")).toBeNull();
  });

  it("returns null when required keys (node, kind) are missing", () => {
    expect(parseVaultNode("---\nlabel: no node or kind here\n---\n")).toBeNull();
  });
});

describe("dagFromFiles", () => {
  it("builds a working Dag from a set of file contents, silently skipping non-node files", () => {
    const dag = dagFromFiles({
      "station/COASTAL.md": "---\nnode: station/COASTAL\nkind: source\n---\nprose",
      "station/INLAND.md": "---\nnode: station/INLAND\nkind: source\n---\nprose",
      "forecast/WEEKEND.md": '---\nnode: forecast/WEEKEND\nkind: derived\ninputs: [station/INLAND, station/COASTAL]\nbasis: "Weekend forecast"\n---\nprose',
      "README.md": "# Not a graph node\n\njust docs",
    });
    expect(dag.nodes.map((n) => n.key).sort()).toEqual(["forecast/WEEKEND", "station/COASTAL", "station/INLAND"]);
    expect(dag.upstreamOf("forecast/WEEKEND")).toEqual(new Set(["station/INLAND", "station/COASTAL"]));
    expect(dag.sourceClosureOf("forecast/WEEKEND")).toEqual(["station/COASTAL", "station/INLAND"]);
  });
});
