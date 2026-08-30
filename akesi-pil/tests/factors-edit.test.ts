import { describe, it, expect } from "vitest";
import { normalizeClientDraft, capFirst } from "@pablotech/akesi-pil/factors-edit";
import type { Client } from "@pablotech/akesi-pil/types";

function baseClient(): Client {
  return { displayName: "Test", dob: "1980-01-01", gender: "male", watchlist: [], results: [], factors: {} };
}

describe("capFirst", () => {
  it("trims and capitalizes the first character", () => {
    expect(capFirst("  hello world ")).toBe("Hello world");
    expect(capFirst("")).toBe("");
  });
});

describe("normalizeClientDraft", () => {
  it("capitalizes and trims authored text the way the CLI add* verbs do", () => {
    const c = baseClient();
    c.factors = {
      diseases: [{ id: "d1", date: " 2024-01 ", diagnostic: " hyperlipidemia ", icdCodes: [" E78.5 ", ""] }],
      treatments: [{ id: "t1", name: " enclomiphene ", dose: " 12.5mg ", kind: "drug", start: " 2026-01 ", end: " " }],
      noteEntries: [{ id: "n1", text: " ask about statin dose " }],
      ethnicity: " white ",
    };
    const out = normalizeClientDraft(c);
    // Authored dates are coerced to the last day of a month-only value (the migration rule).
    // W64 — the id rides through untouched; normalizeClientDraft rewrites content, never identity.
    expect(out.factors!.diseases![0]).toEqual({ id: "d1", date: "2024-01-31", diagnostic: "Hyperlipidemia", icdCodes: ["E78.5"] });
    expect(out.factors!.treatments![0]).toEqual({ id: "t1", name: "Enclomiphene", dose: "12.5mg", kind: "drug", start: "2026-01-31" });
    expect(out.factors!.noteEntries![0]).toEqual({ id: "n1", text: "Ask about statin dose" });
    expect(out.factors!.ethnicity).toBe("White");
  });

  it("drops blank rows and strips emptied arrays back to absent", () => {
    const c = baseClient();
    c.factors = {
      diseases: [{ id: "d1", date: "2024", diagnostic: "  " }],
      treatments: [{ id: "t1", name: " ", dose: "x", kind: "drug", start: "y" }],
      noteEntries: [{ id: "n1", text: "  " }],
    };
    const out = normalizeClientDraft(c);
    expect(out.factors!.diseases).toBeUndefined();
    expect(out.factors!.treatments).toBeUndefined();
    expect(out.factors!.noteEntries).toBeUndefined();
  });

  it("preserves noteEntries order (order is the reorder mechanism, no dedup)", () => {
    const c = baseClient();
    c.factors = {
      noteEntries: [{ id: "n1", text: "second thing" }, { id: "n2", text: "" }, { id: "n3", text: "first thing" }],
    };
    const out = normalizeClientDraft(c);
    expect(out.factors!.noteEntries).toEqual([{ id: "n1", text: "Second thing" }, { id: "n3", text: "First thing" }]);
  });

  it("preserves repeated treatment rows (dose titration over time)", () => {
    const c = baseClient();
    c.factors = {
      treatments: [
        { id: "t1", name: "Testosterone", dose: "100mg", kind: "drug", start: "2025-01" },
        { id: "t2", name: "Testosterone", dose: "120mg", kind: "drug", start: "2025-06" },
      ],
    };
    const out = normalizeClientDraft(c);
    expect(out.factors!.treatments).toHaveLength(2);
  });

  it("dedups decisions by normalized intervention, last write wins", () => {
    const c = baseClient();
    c.factors = {
      decisions: [
        { id: "k1", intervention: "TRT", purpose: "free T" },
        { id: "k2", intervention: "TRT", purpose: "energy" },
      ],
    };
    const out = normalizeClientDraft(c);
    expect(out.factors!.decisions).toHaveLength(1);
    // Last write wins, and it is the LAST entry's id that survives with it.
    expect(out.factors!.decisions![0]).toEqual({ id: "k2", intervention: "TRT", purpose: "Energy" });
  });

  it("collapses an emptied study to absent", () => {
    const c = baseClient();
    c.study = { entries: [{ id: "e1", focus: " ", detail: "x" }] };
    const out = normalizeClientDraft(c);
    expect(out.study).toBeUndefined();
  });

  it("does not mutate the input client", () => {
    const c = baseClient();
    c.factors = { diseases: [{ id: "d1", date: "2024-01", diagnostic: "  hyperlipidemia " } as any] };
    normalizeClientDraft(c);
    expect(c.factors.diseases).toEqual([{ id: "d1", date: "2024-01", diagnostic: "  hyperlipidemia " }]);
  });
});
