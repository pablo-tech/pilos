import { describe, it, expect } from "vitest";
import { buildUserMessage, describeProfile, markerLevelBlocks, populatedNoteEntries, plannedLabels } from "@pablotech/akesi-pil/finding-generate";
import type { Client } from "@pablotech/akesi-pil/types";

// W76 — finding-generate.ts is 81% lines but 60% BRANCHES, and every uncovered branch is a section
// that renders differently, or not at all, for some patient shape. That failure is silent by
// construction: a dropped section does not error, the Finding just comes back thinner, and no
// existing test would notice because the lines around it still execute.
//
// So these assert CONTENT — which sections a given patient's message carries and what they say —
// rather than that the builder ran. Each is written so it fails if the branch it names is inverted.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const base = (over: Partial<Client> = {}) =>
  ({ displayName: "Alex", gender: "male", dob: "1980-05-02", results: [], watchlist: [], ...over }) as unknown as Client;

/** Every optional section, by the exact opening the builder emits for it. */
const OPTIONAL_SECTIONS = {
  plan: "Proposed Plan:",
  study: "Proposed Study:",
  notes: "Notes — patient's free-text jottings",
  diseases: "Diagnosed Disease (prior doctor diagnostics",
  decisions: "Hypothesis Evaluation — patient's proposed interventions",
  patientPlan: "Patient Plan — treatments the patient plans to START",
  onFile: "On-file markers (the AUTHORITATIVE census",
  watchlist: "Watchlist (markers the patient is currently tracking",
  pins: "Areas of query (",
} as const;

function present(message: string): string[] {
  return Object.entries(OPTIONAL_SECTIONS)
    .filter(([, opening]) => message.includes(opening))
    .map(([key]) => key);
}

describe("which sections a patient's message actually carries", () => {
  it("gives an empty record the always-present sections and nothing else", () => {
    const m = buildUserMessage(base());
    expect(present(m)).toEqual([]);
    // The three that are unconditional, because their ABSENCE would read as a fact about the
    // patient rather than about the record.
    expect(m).toContain("Patient Profile: ");
    expect(m).toContain("Treatment History:\n(none recorded)");
    expect(m).toContain("Markers: (no tracked markers and no out-of-range latest readings)");
  });

  const shapes: [keyof typeof OPTIONAL_SECTIONS, Partial<Client>][] = [
    ["plan", { factors: { goal: "feel better" } }],
    ["plan", { factors: { focus: "sleep" } }],
    ["study", { study: { entries: [{ id: "s1", focus: "Sleep", detail: "8h" }] } }],
    ["notes", { factors: { noteEntries: [{ id: "n1", text: "knee hurts" }] } }],
    ["diseases", { factors: { diseases: [{ id: "d1", date: "2024-02-01", diagnostic: "T2D" }] } }],
    ["decisions", { factors: { decisions: [{ id: "h1", intervention: "creatine", purpose: "strength" }] } }],
    ["patientPlan", { factors: { treatments: [{ id: "t1", name: "Pregnenolone", start: "2099-01-15" }] } }],
    ["watchlist", { watchlist: ["ApoB"] }],
    ["onFile", { results: [{ marker: "ApoB", date: daysAgo(30), value: 90, unit: "mg/dL" }] }],
    ["pins", { pinnedRatios: ["TG/HDL"] }],
  ] as unknown as [keyof typeof OPTIONAL_SECTIONS, Partial<Client>][];

  for (const [key, over] of shapes) {
    it(`renders ${key} for the shape that calls for it, and only that section`, () => {
      const got = present(buildUserMessage(base(over)));
      // "only that section" is the half that catches a builder emitting a header off the wrong
      // condition — a watchlist entry must not conjure an On-file census, and vice versa.
      expect(got.filter((k) => k !== "onFile" || key === "onFile")).toEqual([key]);
    });
  }

  it("does not present a note that is only whitespace, in the section or in the count", () => {
    const client = base({ factors: { noteEntries: [{ id: "n1", text: "   " }, { id: "n2", text: "real" }] } } as never);
    expect(populatedNoteEntries(client).map((n) => n.id)).toEqual(["n2"]);
    // Numbered from 1 over the PRESENTED set: numbering the raw array would tell the model there is
    // a note 1 it cannot see, and noteResults is paired back by position.
    expect(buildUserMessage(client)).toContain("  1. real");
  });

  it("names a planned treatment in the Patient Plan and nowhere in the ongoing regimen", () => {
    const client = base({ factors: { treatments: [{ id: "t1", name: "Pregnenolone", start: "2099-01-15" }] } } as never);
    const m = buildUserMessage(client);
    expect(plannedLabels(client, iso(new Date()))).toHaveLength(1);
    expect(m).toContain("Treatment History:\n(none recorded)");
    expect(m).toContain('  - Action: "');
  });
});

describe("the profile line", () => {
  it("omits every factor that was never recorded rather than saying 'unknown'", () => {
    const now = new Date();
    const had = now.getMonth() > 4 || (now.getMonth() === 4 && now.getDate() >= 2);
    expect(describeProfile(base())).toBe(`${now.getFullYear() - 1980 - (had ? 0 : 1)}-year-old male`);
  });

  it("says 'unknown age' rather than dropping the clause when there is no date of birth", () => {
    expect(describeProfile(base({ dob: undefined } as never))).toContain("unknown age-year-old male");
  });

  it("carries a diagnosis's ICD codes and summary, which are what the finding reasons over", () => {
    const p = describeProfile(base({
      factors: { diseases: [{ id: "d1", date: "2024-02-01", diagnostic: "T2D", icdCodes: ["E11.9"], summary: "HbA1c 7.4" }] },
    } as never));
    expect(p).toContain("prior diagnoses: T2D [E11.9] — HbA1c 7.4 (2024-02-01)");
  });

  it("prints a BMI of zero, because a recorded number is not the same as no number", () => {
    // `if (f.bmi)` would drop it. The value is nonsense clinically, but silently discarding a
    // recorded field is how a profile comes to disagree with the record it was built from.
    expect(describeProfile(base({ factors: { bmi: 0 } } as never))).toContain("BMI 0");
  });

  it("suppresses a pregnancy of 'none' while carrying any other value", () => {
    expect(describeProfile(base({ factors: { pregnancy: "none" } } as never))).not.toContain("none");
    expect(describeProfile(base({ factors: { pregnancy: "second trimester" } } as never))).toContain("second trimester");
  });

  it("drops an empty list instead of announcing an empty one", () => {
    const p = describeProfile(base({ factors: { diseases: [], allergies: [], familyHistory: [] } } as never));
    expect(p).not.toContain("prior diagnoses");
    expect(p).not.toContain("allergies");
    expect(p).not.toContain("family history");
  });
});

describe("which markers reach the deep Markers block", () => {
  const reading = (marker: string, value: number, date: string) => ({ marker, date, value, unit: "mg/dL" });

  it("pulls in a marker nobody is watching when its LATEST reading is out of personalized range", () => {
    const client = base({
      results: [reading("ApoB", 130, daysAgo(20))],
      personalizedRanges: { ApoB: { high: 80, unit: "mg/dL" } },
    } as never);
    expect(markerLevelBlocks(client).map((b) => b.split(" ")[0])).toEqual(["ApoB"]);
  });

  it("leaves it out when only an OLDER reading was out of range", () => {
    const client = base({
      results: [reading("ApoB", 130, daysAgo(400)), reading("ApoB", 60, daysAgo(20))],
      personalizedRanges: { ApoB: { high: 80, unit: "mg/dL" } },
    } as never);
    // The latest is what the range question is asked of; a resolved excursion is not a live one.
    expect(markerLevelBlocks(client)).toEqual([]);
  });

  it("catches a low excursion as well as a high one", () => {
    const client = base({
      results: [reading("Ferritin", 8, daysAgo(10))],
      personalizedRanges: { Ferritin: { low: 30, unit: "ng/mL" } },
    } as never);
    expect(markerLevelBlocks(client)).toHaveLength(1);
  });

  it("keeps a watched marker that has never been measured out of the block entirely", () => {
    // markerContext returns null with no rows; a block header with no readings under it invites the
    // model to describe a marker it has no data for.
    expect(markerLevelBlocks(base({ watchlist: ["ApoB"] }))).toEqual([]);
  });

  it("prefers the personalized target over the lab's reference range, and says which it used", () => {
    const withRef = { marker: "ApoB", date: daysAgo(10), value: 70, unit: "mg/dL", ref: { low: 10, high: 90 } };
    const personalized = markerLevelBlocks(base({
      watchlist: ["ApoB"], results: [withRef], personalizedRanges: { ApoB: { high: 60, unit: "mg/dL" } },
    } as never))[0];
    expect(personalized).toContain("Personalized target: < 60.0 mg/dL");
    expect(personalized).not.toContain("Lab reference");

    const fallback = markerLevelBlocks(base({ watchlist: ["ApoB"], results: [withRef] } as never))[0];
    expect(fallback).toContain("Lab reference (no personalized range): 10.0–90.0 mg/dL");
  });

  it("says outright when a watched marker has gone a year without a reading", () => {
    const block = markerLevelBlocks(base({
      watchlist: ["ApoB"], results: [{ marker: "ApoB", date: daysAgo(500), value: 70, unit: "mg/dL" }],
    } as never))[0];
    expect(block).toContain("Last year: (no readings in the past 12 months)");
    expect(block).toContain("Prior (1 reading");
  });

  it("says 'no earlier data' rather than leaving a first reading looking like a trend", () => {
    const block = markerLevelBlocks(base({
      watchlist: ["ApoB"], results: [{ marker: "ApoB", date: daysAgo(10), value: 70, unit: "mg/dL" }],
    } as never))[0];
    expect(block).toContain("Prior: (no earlier data)");
    expect(block).not.toContain("Change vs prior reading");
  });

  it("hands the model the computed change instead of leaving it to subtract", () => {
    const block = markerLevelBlocks(base({
      watchlist: ["ApoB"],
      results: [{ marker: "ApoB", date: daysAgo(200), value: 100, unit: "mg/dL" }, { marker: "ApoB", date: daysAgo(10), value: 80, unit: "mg/dL" }],
    } as never))[0];
    expect(block).toContain("Change vs prior reading");
    expect(block).toContain("-20.0 mg/dL");
  });

  it("shows a qualitative reading as its text, not as a number it never had", () => {
    const block = markerLevelBlocks(base({
      watchlist: ["Urine protein"],
      results: [{ marker: "Urine protein", date: daysAgo(10), value: 0, unit: "", valueText: "negative" }],
    } as never))[0];
    expect(block).toContain("negative");
  });
});

describe("the on-file census", () => {
  const census = (client: Client) => buildUserMessage(client).split("On-file markers")[1] ?? "";

  it("lists a marker that is neither watched nor out of range, which is the whole point of it", () => {
    const c = base({ results: [{ marker: "TSH", date: daysAgo(30), value: 2.1, unit: "mIU/L" }] } as never);
    expect(markerLevelBlocks(c)).toEqual([]);
    // Absent here, the model recommends re-ordering a lab the patient already has.
    expect(census(c)).toContain("TSH — 2.10 mIU/L");
  });

  it("tags recency so the requisition is driven by the date, not by the model's guess", () => {
    const c = base({
      results: [
        { marker: "ApoB", date: daysAgo(30), value: 90, unit: "mg/dL" },
        { marker: "Lp(a)", date: daysAgo(300), value: 40, unit: "nmol/L" },
      ],
    } as never);
    const text = census(c);
    expect(text).toMatch(/ApoB — .*\[within 6mo\]/);
    expect(text).toMatch(/Lp\(a\) — .*\[>6mo — overdue\]/);
  });

  it("reports the latest reading per marker, whatever order they arrived in", () => {
    const c = base({
      results: [
        { marker: "ApoB", date: daysAgo(10), value: 70, unit: "mg/dL" },
        { marker: "ApoB", date: daysAgo(400), value: 130, unit: "mg/dL" },
      ],
    } as never);
    expect(census(c)).toContain("ApoB — 70.0 mg/dL");
    expect(census(c)).not.toContain("130");
  });

  it("appends a personalized target where one exists and stays silent where none does", () => {
    const c = base({
      results: [
        { marker: "ApoB", date: daysAgo(10), value: 70, unit: "mg/dL" },
        { marker: "TSH", date: daysAgo(10), value: 2.1, unit: "mIU/L" },
      ],
      personalizedRanges: { ApoB: { low: 40, high: 60, unit: "mg/dL" } },
    } as never);
    expect(census(c)).toContain("target 40.0–60.0 mg/dL");
    expect(census(c)).toMatch(/TSH — 2\.10 mIU\/L, \d{4}-\d{2}-\d{2} \[within 6mo\]\n?/);
  });
});
