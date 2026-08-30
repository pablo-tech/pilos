import type { Client } from "../../types";
import { addDisease } from "../../factors-edit";

// Synthetic Client shapes and variant names used to regenerate the golden .txt fixtures. Kept
// package-local rather than pulled in from a host app: a host's own addTreatment/addDecision
// helpers typically depend on version-registry machinery that's out of scope for this package (see
// ../../ARCHITECTURE.md §8 *The host's job: a brain registry*). Only addDisease is reused
// directly; it lives in this package's own factors-edit.ts.

function bare(): Client {
  return { displayName: "Bare", dob: "1980-01-01", gender: "male", watchlist: [], results: [], factors: {} };
}

function fullyPopulated(): Client {
  return {
    displayName: "Full",
    dob: "1975-06-15",
    gender: "female",
    watchlist: ["ApoB", "LDL"],
    results: [
      { marker: "ApoB", group: "Lipids", source: "lab", date: "2026-01-01", value: 80, unit: "mg/dL" },
      { marker: "LDL", group: "Lipids", source: "lab", date: "2026-01-01", value: 120, unit: "mg/dL" },
    ],
    factors: {
      diseases: [{ id: "d1", date: "2025", diagnostic: "CAC 100", summary: "Moderate calcification" }],
      treatments: [
        { id: "t1", name: "Ezetimibe", dose: "10 mg", kind: "drug", start: "2025-01" }, // ongoing
        { id: "t2", name: "Statin", kind: "drug", start: "2024-01", end: "2024-12" }, // past
        { id: "t3", name: "Start rosuvastatin", kind: "drug", start: "2099-02" }, // planned
      ],
      allergies: [{ id: "a1", pinned: true, allergen: "Penicillin", reaction: "Hives", severity: "moderate", dateNoted: "2020-01-01" }],
      familyHistory: [{ id: "f1", relation: "Father", condition: "MI at 55" }],
      decisions: [{ id: "d1", intervention: "TRT", purpose: "free T" }],
      noteEntries: [
        { id: "n1", text: "Ask about statin intolerance" },
        { id: "n2", pinned: true, text: "" }, // blank text — noteCanonical filters this out
      ],
      pregnancy: "none",
      athletic: "moderate",
      bmi: 24.5,
      height: "5'10\"",
      smoking: "never",
      ethnicity: "Hispanic",
      goal: "lower ApoB",
      focus: "cardiovascular",
    },
    study: { entries: [{ id: "study-1", focus: "Suspicion", detail: "CVD" }] },
  };
}

function emptyFactors(): Client {
  return { displayName: "Empty", dob: "1990-03-20", gender: "male", watchlist: [], results: [] };
}

// Mirrors hash-consistency.test.ts's regression guard: data shaped the way a host's editing verbs
// (addTreatment/addDisease/addDecision) actually produce it, since that is how a Finding's
// nodeHashes get stamped in production. addTreatment/addDecision's own
// normalization (capFirst, endOfMonth) is applied inline below rather than imported, for the reason
// in the file header; addDisease is imported since it's already package-owned.
function cliAuthored(): Client {
  const c: Client = { displayName: "CLI", dob: "1982-11-02", gender: "female", watchlist: ["ApoB"], results: [], factors: {} };
  c.factors!.treatments = [
    { id: "t1", name: "Enclomiphene", start: "2026-01-31", dose: "12.5mg", kind: "drug" },
    { id: "t2", name: "Tirzepatide", start: "2025-08-31", dose: "6mg/week", kind: "drug", end: "2025-12-31" },
  ];
  addDisease(c, { date: "2024-01", diagnostic: "Hyperlipidemia" });
  c.factors!.decisions = [{ id: "dec1", intervention: "TRT", purpose: "Improved free T" }];
  return c;
}

export const CANONICAL_VARIANTS: Record<string, () => Client> = {
  bare,
  fullyPopulated,
  emptyFactors,
  cliAuthored,
};

// The Ranges USER message varies on the marker, not on the patient — it reads client.results and
// nothing else. Covering it by CANONICAL_VARIANTS would emit near-identical files that read as
// coverage without exercising a second branch, so these cases are named for the branch each one
// reaches: a plain measured unit, a dimensionless ratio, a unit with an imperial equivalent, and a
// marker with nothing on file. Between them they cover every branch in rangesUserMessage.
function withResults(marker: string, unit: string, values: number[]): Client {
  const c = bare();
  const dates = ["2024-02-14", "2024-09-03", "2025-04-21", "2025-11-08", "2026-01-16", "2026-05-19"];
  c.results = values.map((value, i) => ({ marker, group: "Body", source: "lab", date: dates[i], value, unit }));
  return c;
}

export const RANGES_MARKER_CASES: Record<string, () => { client: Client; marker: string }> = {
  measured: () => ({ client: fullyPopulated(), marker: "ApoB" }),
  // Six readings against a five-reading window: the golden shows which five survive.
  dimensionless: () => ({
    client: withResults("Android/Gynoid % fat ratio", "", [1.02, 0.98, 0.94, 0.91, 0.89, 0.86]),
    marker: "Android/Gynoid % fat ratio",
  }),
  imperial: () => ({ client: withResults("Lean mass", "kg", [61.2, 62.4, 63.1]), marker: "Lean mass" }),
  // Reachable in this package but not from its host: the host's NoMeasuredUnitError guard rejects a
  // marker with no readings before the message is built, which is why this golden shows a
  // no-readings marker being described as dimensionless. The package deliberately does not make
  // that call for its host — see unitForMarker.
  unmeasured: () => ({ client: bare(), marker: "Lp(a)" }),
};
