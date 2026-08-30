import { describe, it, expect } from "vitest";
import { validate, IMPERIAL_CONVERTS } from "@pablotech/akesi-pil/ranges-prompt";
import type { RangeAIResponse } from "@pablotech/akesi-pil/ranges-prompt";

// W71 — `validate` had no tests at all, and it is the only thing standing between a model's answer
// and a range drawn on a patient's marker chart. Every branch below is a way a plausible-looking
// response becomes a clinically wrong picture: an inverted range shades "safe" over the danger zone,
// a unit mismatch judges ApoB in mg/dL against a range in g/L.
//
// Asserted as "does it throw", not on message text, except where the message is the only thing that
// distinguishes two failures a caller might act on differently.

const ok = (over: Partial<RangeAIResponse> = {}): RangeAIResponse =>
  ({
    low: 40,
    high: 80,
    unit: "mg/dL",
    meaning: "a lipoprotein particle count",
    explanation: "lower is better for this patient given family history",
    generalLow: 20,
    generalHigh: 130,
    generalExplanation: "the usual laboratory reference interval",
    ...over,
  }) as RangeAIResponse;

describe("a range the model returns has to be a range", () => {
  it("accepts a complete, coherent response", () => {
    expect(() => validate("ApoB", "mg/dL", ok())).not.toThrow();
  });

  it("rejects a response with neither bound", () => {
    expect(() => validate("ApoB", "mg/dL", ok({ low: null, high: null }))).toThrow(/neither low nor high/);
  });

  it.each([
    ["only a low bound", { high: null }],
    ["only a high bound", { low: null }],
  ])("accepts %s — a one-sided range is legitimate", (_n, over) => {
    expect(() => validate("ApoB", "mg/dL", ok(over as Partial<RangeAIResponse>))).not.toThrow();
  });

  it("rejects an inverted range", () => {
    // Shipping this shades the chart's "safe" band over the danger zone.
    expect(() => validate("ApoB", "mg/dL", ok({ low: 80, high: 40 }))).toThrow(/low \(80\) >= high \(40\)/);
  });

  it("rejects a zero-width range, where low equals high", () => {
    expect(() => validate("ApoB", "mg/dL", ok({ low: 50, high: 50 }))).toThrow(/>=/);
  });

  it("applies the same two rules to the general range", () => {
    expect(() => validate("ApoB", "mg/dL", ok({ generalLow: null, generalHigh: null }))).toThrow(/neither generalLow nor generalHigh/);
    expect(() => validate("ApoB", "mg/dL", ok({ generalLow: 130, generalHigh: 20 }))).toThrow(/generalLow \(130\) >= generalHigh \(20\)/);
  });

  it("accepts a bound of exactly zero rather than reading it as absent", () => {
    // `== null` and not `!x`, or a legitimate lower bound of 0 would be rejected as missing.
    expect(() => validate("Ketones", "mmol/L", ok({ low: 0, high: 3, generalLow: 0, generalHigh: 5, unit: "mmol/L" }))).not.toThrow();
  });

  it("accepts zero as the ONLY bound — the case that tells `== null` apart from falsy", () => {
    // With a truthy partner bound both implementations agree, which is why the test above passed a
    // mutation from `r.low == null` to `!r.low`. A sole bound of 0 is the one input that separates
    // them: a marker whose target is "as close to zero as possible" is a real thing to express.
    expect(() =>
      validate("Ketones", "mmol/L", ok({ low: 0, high: null, generalLow: 0, generalHigh: null, unit: "mmol/L" })),
    ).not.toThrow();
  });
});

describe("the units have to be the units the lab reported", () => {
  it("rejects a response in different units", () => {
    expect(() => validate("ApoB", "mg/dL", ok({ unit: "g/L" }))).toThrow(/returned unit "g\/L" but lab data is in "mg\/dL"/);
  });

  it("rejects a blank unit when the lab data has one", () => {
    expect(() => validate("ApoB", "mg/dL", ok({ unit: "   " }))).toThrow(/missing unit/);
  });

  it.each([
    ["case", "MG/DL"],
    ["internal whitespace", "mg / dL"],
    ["a micro sign", "umol/L"],
  ])("tolerates a difference of %s, which is formatting rather than meaning", (_n, unit) => {
    const expected = unit === "umol/L" ? "μmol/L" : "mg/dL";
    expect(() => validate("M", expected, ok({ unit }))).not.toThrow();
  });

  it("a unitless marker must come back unitless", () => {
    expect(() => validate("Ratio", "", ok({ unit: "" }))).not.toThrow();
    // Inventing a unit for a unitless marker is a mismatch, not a nicety.
    expect(() => validate("Ratio", "", ok({ unit: "mg/dL" }))).toThrow(/returned unit/);
  });
});

describe("the prose a patient reads has to be there", () => {
  it.each([
    ["meaning", "meaning", /missing meaning/],
    ["explanation", "explanation", /missing explanation/],
    ["generalExplanation", "generalExplanation", /missing generalExplanation/],
  ])("rejects a missing %s", (_n, field, msg) => {
    expect(() => validate("ApoB", "mg/dL", ok({ [field]: "" } as Partial<RangeAIResponse>))).toThrow(msg);
    // Whitespace is not prose — a model that answers " " must fail the same way.
    expect(() => validate("ApoB", "mg/dL", ok({ [field]: "   " } as Partial<RangeAIResponse>))).toThrow(msg);
  });
});

describe("imperial explanations are required exactly where a conversion exists", () => {
  it.each(Object.keys(IMPERIAL_CONVERTS))("%s needs one", (unit) => {
    expect(() => validate("M", unit, ok({ unit, explanationImperial: "" }))).toThrow(/missing imperial explanation/);
    expect(() => validate("M", unit, ok({ unit, explanationImperial: "about 2 lb" }))).not.toThrow();
  });

  it("a unit with no conversion does not need one", () => {
    expect(IMPERIAL_CONVERTS["mg/dL"]).toBeUndefined();
    expect(() => validate("ApoB", "mg/dL", ok({ explanationImperial: "" }))).not.toThrow();
  });

  // Derived from the table rather than a hand-listed set, so a unit added to IMPERIAL_CONVERTS is
  // covered the moment it is added.
  it("the table is not empty, so the sweep above cannot pass vacuously", () => {
    expect(Object.keys(IMPERIAL_CONVERTS).length).toBeGreaterThan(3);
  });
});
