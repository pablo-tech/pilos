import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { promptGolden, DIR } from "./gen-prompt-golden";
import { CANONICAL_VARIANTS, RANGES_MARKER_CASES } from "./fixtures/canonical-variants";

// Covers this package's own prompt surfaces (finding, ranges, report-extract, marker-groups); a
// host app's other prompt surfaces (e.g. a free-form chat prompt) and any app-side retry-suffix
// source-assertion stay in the host, since both are host-owned concerns outside this package.
//
// The failure mode this must survive is its own maintenance. A fixture regenerated whenever it goes
// red is worse than none, because it reads as coverage. Two things guard that: the clock and the
// timezone are pinned so it never goes red by itself, and `npm run prompt:golden` regenerates every
// file at once so a deliberate change is one reviewable diff rather than a hand-edit.

const golden = () => promptGolden();
const onDisk = (name: string) => readFileSync(DIR + name, "utf8");

describe("the clinical prompt is what it was when someone last looked at it", () => {
  it("the fixture exists at all", () => {
    // Guards the guard: an empty directory would make every assertion below vacuous.
    expect(existsSync(DIR)).toBe(true);
    expect(readdirSync(DIR).filter((f) => f.endsWith(".txt")).length).toBeGreaterThanOrEqual(18);
  });

  it.each(Object.keys(golden()))("%s is unchanged", (name) => {
    expect(onDisk(name).trimEnd()).toBe(golden()[name].trimEnd());
  });

  it("every file on disk is still produced by the generator", () => {
    // The other direction: a prompt variant deleted from the code but left on disk would otherwise sit
    // there being silently asserted against nothing.
    const produced = new Set(Object.keys(golden()));
    const orphans = readdirSync(DIR).filter((f) => f.endsWith(".txt") && !produced.has(f));
    expect(orphans).toEqual([]);
  });
});

describe("the prompt says the things it must not stop saying", () => {
  // Not a substitute for the diff — a reviewer reading a regenerated fixture is. These are the few
  // clinical-safety instructions whose REMOVAL should fail loudly rather than being one quiet line in
  // a large diff that gets approved on a Friday.
  const system = onDisk("system--finding.txt");

  it.each([
    ["is decision support, not a diagnosis", /not a (diagnosis|physician)/i],
    ["frames suggestions for the patient's physician", /physician/i],
    ["refuses to invent data", /never|do not/i],
  ])("still %s", (_label, pattern) => {
    expect(system).toMatch(pattern);
  });

  it("is generated from a synthetic roster and nothing else", () => {
    // A real person reaching a fixture would be a PHI leak into a published artefact. This checks the
    // generator's INPUT rather than scanning its output for names, because the two are already tied:
    // the goldens are pinned byte-for-byte to what this roster produces ("%s is unchanged", above), so
    // nothing can reach a fixture without entering here first.
    //
    // It deliberately names only the synthetic values. A denylist of the real names would publish, in
    // the open repo, precisely what it exists to keep out — and would still miss a fourth person.
    const NAMES = ["Bare", "Full", "Empty", "CLI"];
    const DOBS = ["1980-01-01", "1975-06-15", "1990-03-20", "1982-11-02"];
    const clients = [
      ...Object.values(CANONICAL_VARIANTS).map((f) => f()),
      ...Object.values(RANGES_MARKER_CASES).map((f) => f().client),
    ];
    expect(clients.length).toBeGreaterThan(NAMES.length); // guards the guard: an empty roster proves nothing
    for (const c of clients) {
      expect(NAMES).toContain(c.displayName);
      expect(DOBS).toContain(c.dob);
    }
  });
});
