import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, runLint, runMermaid, runStale, staleLines, walkVault } from "../cli";
import { renderMermaid } from "../mermaid";
import { dagFromFiles } from "../markdown";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/synthetic-vault");

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "neuro-pil-cli-test-"));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("parses a bare subcommand and dir", () => {
    expect(parseArgs(["lint", "somedir"])).toEqual({ command: "lint", dir: "somedir" });
  });

  it("parses --write and --json flags", () => {
    expect(parseArgs(["mermaid", "somedir", "--write", "out.md"])).toEqual({
      command: "mermaid", dir: "somedir", write: "out.md",
    });
    expect(parseArgs(["lint", "somedir", "--json"])).toEqual({
      command: "lint", dir: "somedir", json: true,
    });
  });

  it("parses stale's --update flag", () => {
    expect(parseArgs(["stale", "somedir", "--update", "--json"])).toEqual({
      command: "stale", dir: "somedir", update: true, json: true,
    });
  });

  it("throws on an unknown subcommand", () => {
    expect(() => parseArgs(["bogus", "somedir"])).toThrow(/unknown subcommand/);
  });

  it("throws when the dir argument is missing", () => {
    expect(() => parseArgs(["lint"])).toThrow(/requires a <dir>/);
  });
});

describe("runLint", () => {
  it("is clean on the synthetic-vault fixture", () => {
    const result = runLint(FIXTURE);
    expect(result.findings).toEqual([]);
    expect(result.nodeCount).toBe(3);
  });

  it("reports an unknown-input finding", () => {
    const dir = scratch();
    writeFileSync(join(dir, "a.md"), "---\nnode: a\nkind: derived\ninputs: [ghost]\n---\n");
    const result = runLint(dir);
    expect(result.findings).toEqual([
      { rule: "unknown-input", node: "a", message: '"a" lists unknown input "ghost"' },
    ]);
    expect(result.nodeCount).toBe(1);
  });
});

describe("runMermaid", () => {
  it("matches renderMermaid(dagFromFiles(walkVault(...))) exactly", () => {
    expect(runMermaid(FIXTURE)).toBe(renderMermaid(dagFromFiles(walkVault(FIXTURE))));
  });

  it("contains every node key and edge", () => {
    const body = runMermaid(FIXTURE);
    expect(body).toContain("station/COASTAL");
    expect(body).toContain("station/INLAND");
    expect(body).toContain("forecast/WEEKEND");
    expect(body).toContain("station/COASTAL --> forecast/WEEKEND");
    expect(body).toContain("station/INLAND --> forecast/WEEKEND");
  });
});

describe("runStale", () => {
  it("reports baseline: true and does not write a stamp on a first run with no --update", () => {
    const dir = scratch();
    cpSync(FIXTURE, dir, { recursive: true });
    const result = runStale(dir);
    expect(result.baseline).toBe(true);
    expect(result.drifted).toEqual([]);
    expect(existsSync(join(dir, ".neuro-pil", "stamp.json"))).toBe(false);
  });

  it("--update writes the stamp, and a later mutation is reported as drift only on the mutated node and its downstream derived node", () => {
    const dir = scratch();
    cpSync(FIXTURE, dir, { recursive: true });

    const baseline = runStale(dir, { update: true });
    expect(baseline.baseline).toBe(true);
    expect(existsSync(join(dir, ".neuro-pil", "stamp.json"))).toBe(true);

    const coastalPath = join(dir, "station/COASTAL.md");
    writeFileSync(coastalPath, readFileSync(coastalPath, "utf8").replace("18kt", "22kt"));

    const result = runStale(dir);
    expect(result.baseline).toBe(false);
    expect(result.drifted.sort()).toEqual(["forecast/WEEKEND", "station/COASTAL"]);
  });
});

// The output half of the `stale` contract in neuro-pil/README.md: --update reports whatever drift
// was found against the old stamp *before* announcing the write, so a run that exits 1 says why.
describe("staleLines", () => {
  const drifted = { baseline: false, drifted: ["forecast/WEEKEND", "station/COASTAL"], nodeCount: 3 };
  const clean = { baseline: false, drifted: [], nodeCount: 3 };
  const first = { baseline: true, drifted: [], nodeCount: 3 };
  const stampLine = `Wrote stamp for 3 nodes into ${join("/v", ".neuro-pil", "stamp.json")}`;

  it("reports every drifted key before the write line under --update", () => {
    expect(staleLines(drifted, { dir: "/v", update: true })).toEqual([
      "[stale] forecast/WEEKEND",
      "[stale] station/COASTAL",
      stampLine,
    ]);
  });

  it("still says there was no drift under --update", () => {
    expect(staleLines(clean, { dir: "/v", update: true })).toEqual([
      "neuro-pil: no drift across 3 stamped nodes.",
      stampLine,
    ]);
  });

  it("still says there was no prior stamp under --update", () => {
    expect(staleLines(first, { dir: "/v", update: true })).toEqual([
      "no prior stamp — nothing to compare.",
      stampLine,
    ]);
  });

  it("omits the write line without --update", () => {
    expect(staleLines(drifted, { dir: "/v" })).toEqual(["[stale] forecast/WEEKEND", "[stale] station/COASTAL"]);
    expect(staleLines(clean, { dir: "/v" })).toEqual(["neuro-pil: no drift across 3 stamped nodes."]);
    expect(staleLines(first, { dir: "/v" })).toEqual(["no prior stamp — nothing to compare."]);
  });

  it("emits one JSON line carrying the drift, with --json winning over the text form", () => {
    expect(staleLines(drifted, { dir: "/v", update: true, json: true })).toEqual([
      JSON.stringify({ ...drifted, updated: true }),
    ]);
    expect(staleLines(drifted, { dir: "/v", json: true })).toEqual([
      JSON.stringify({ ...drifted, updated: false }),
    ]);
  });
});

// Sanity check that the fixture's raw markdown reads as expected by the manual e2e verification
// commands (which `sed` "18kt" -> "22kt" in station/COASTAL.md to trigger drift).
describe("fixture", () => {
  it("station/COASTAL.md contains the literal text the drift-verification sed targets", () => {
    expect(readFileSync(join(FIXTURE, "station/COASTAL.md"), "utf8")).toContain("18kt");
  });
});
