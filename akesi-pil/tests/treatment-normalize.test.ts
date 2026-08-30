import { describe, it, expect } from "vitest";
import { normalizeDate, parseSince, normalizeTreatments } from "@pablotech/akesi-pil/treatment-normalize";

describe("normalizeDate", () => {
  it("parses 'Since Month Year'", () => {
    expect(normalizeDate("Since August 2025")).toBe("2025-08");
  });
  it("parses 'Since Month Day, Year'", () => {
    expect(normalizeDate("Since November 1, 2025")).toBe("2025-11");
  });
  it("parses a bare 'Month Year'", () => {
    expect(normalizeDate("September 2025")).toBe("2025-09");
  });
  it("keeps a year-only value", () => {
    expect(normalizeDate("2010")).toBe("2010");
  });
  it("passes ISO through", () => {
    expect(normalizeDate("2026-07")).toBe("2026-07");
    expect(normalizeDate("2025-9")).toBe("2025-09");
  });
  it("returns empty for prose / non-dates", () => {
    expect(normalizeDate("")).toBe("");
    expect(normalizeDate("TBD")).toBe("");
    expect(normalizeDate("At earliest possibility")).toBe("");
    expect(normalizeDate("When overnight HRV rises")).toBe("");
  });
});

describe("parseSince (range split)", () => {
  it("splits an en-dash window, borrowing the year from the end", () => {
    expect(parseSince("April–May 2026")).toEqual({ start: "2026-04", end: "2026-05" });
  });
  it("returns start only for a single date", () => {
    expect(parseSince("August 2025")).toEqual({ start: "2025-08" });
  });
});

describe("normalizeTreatments (legacy fold)", () => {
  it("folds medications/supplements/plan into one unified list", () => {
    const out = normalizeTreatments({
      medications: [{ drug: "Tirzepatide", dose: "6mg/week", since: "Since August 2025" }],
      supplements: [{ drug: "Glycine", dose: "5g", since: "" }],
      plan: [{ action: "Start enclomiphene 12.5mg EOD", date: "2026-07" }],
    });
    expect(out).toEqual([
      { id: expect.any(String), name: "Tirzepatide", kind: "drug", start: "2025-08", dose: "6mg/week" },
      { id: expect.any(String), name: "Glycine", kind: "supplement", start: "", dose: "5g" },
      { id: expect.any(String), name: "Start enclomiphene 12.5mg EOD", kind: "behavior", start: "2026-07" },
    ]);
  });

  it("splits a closed titration window into start+end", () => {
    const out = normalizeTreatments({
      supplements: [{ drug: "DHEA", dose: "10mg", since: "April–May 2026" }],
    });
    expect(out[0]).toEqual({
      id: expect.any(String),
      name: "DHEA",
      kind: "supplement",
      start: "2026-04",
      end: "2026-05",
      dose: "10mg",
    });
  });

  it("is idempotent when treatments already exist", () => {
    // W64 — a TreatmentItem carries an id; normalizeTreatments returns the array UNTOUCHED when
    // one is present, which is what `toBe` (identity) below asserts.
    const treatments = [{ id: "t1", name: "X", kind: "drug" as const, start: "2025-01" }];
    expect(normalizeTreatments({ treatments, medications: [{ drug: "Y" }] })).toBe(treatments);
  });
});
