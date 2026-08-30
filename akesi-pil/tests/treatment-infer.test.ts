import { describe, it, expect } from "vitest";
import { validate, type ProposedTreatment } from "@pablotech/akesi-pil/treatment-infer";

function ok(): ProposedTreatment {
  return { name: "Lipitor", kind: "drug" };
}

describe("treatment-infer validate", () => {
  it("accepts a well-formed drug result", () => {
    expect(() => validate(ok())).not.toThrow();
  });

  it("accepts a well-formed supplement result", () => {
    expect(() => validate({ name: "Vitamin D3", kind: "supplement" })).not.toThrow();
  });

  it("rejects an empty name", () => {
    const r = ok(); r.name = "";
    expect(() => validate(r)).toThrow(/missing name/);
  });

  it("rejects a bad kind value", () => {
    const r = { name: "Lipitor", kind: "vitamin" } as unknown as ProposedTreatment;
    expect(() => validate(r)).toThrow(/kind must be "drug" or "supplement"/);
  });
});

describe("treatment-infer validate — product fields", () => {
  const base = () => ({ name: "Thyroid Support", kind: "supplement" }) as ProposedTreatment;

  // Lenient on the product half deliberately: a malformed ingredient shouldn't throw away a good
  // name/kind extraction, so these are normalized rather than rejected.
  it("keeps well-formed ingredients and links", () => {
    const r = { ...base(), ingredients: [{ name: "Selenium", amount: 100, unit: "mcg" }], links: [{ label: "COA", url: "https://a.com/c" }] } as ProposedTreatment;
    validate(r);
    expect(r.ingredients).toEqual([{ name: "Selenium", amount: 100, unit: "mcg" }]);
    expect(r.links).toEqual([{ label: "COA", url: "https://a.com/c" }]);
  });

  it("strips an unsafe URL the model echoed out of the source", () => {
    const r = { ...base(), links: [{ label: "x", url: "javascript:alert(1)" }] } as ProposedTreatment;
    validate(r);
    expect(r.links).toBeUndefined();
  });

  it("drops empty product fields rather than storing blanks", () => {
    const r = { ...base(), description: "   ", ingredients: [], links: [] } as ProposedTreatment;
    validate(r);
    expect(r.description).toBeUndefined();
    expect(r.ingredients).toBeUndefined();
    expect(r.links).toBeUndefined();
  });

  it("keeps maker verbatim, and drops a blank one", () => {
    const withMaker = { ...base(), maker: "Thorne" } as ProposedTreatment;
    validate(withMaker);
    expect(withMaker.maker).toBe("Thorne");

    const blank = { ...base(), maker: "  " } as ProposedTreatment;
    validate(blank);
    expect(blank.maker).toBeUndefined();
  });

  it("still rejects a bad name or kind — that half is the inference failing", () => {
    expect(() => validate({ ...base(), name: "" } as ProposedTreatment)).toThrow();
    expect(() => validate({ ...base(), kind: "behavior" } as unknown as ProposedTreatment)).toThrow();
  });
});

describe("treatment-infer validate — administration", () => {
  const base = () => ({ name: "Thyroid Support", kind: "supplement" }) as ProposedTreatment;

  it("keeps a well-formed administration, defaulting unitsPerServing to 1 when absent", () => {
    const r = { ...base(), administration: { unit: "capsule", suggestedUnits: 1, suggestedFrequency: "day" } } as ProposedTreatment;
    validate(r);
    expect(r.administration).toEqual({ unit: "capsule", unitsPerServing: 1, suggestedUnits: 1, suggestedFrequency: "day" });
  });

  it("keeps an explicit unitsPerServing (a label's own Serving Size)", () => {
    const r = { ...base(), administration: { unit: "softgel", unitsPerServing: 2, suggestedUnits: 2, suggestedFrequency: "day" } } as ProposedTreatment;
    validate(r);
    expect(r.administration).toEqual({ unit: "softgel", unitsPerServing: 2, suggestedUnits: 2, suggestedFrequency: "day" });
  });

  it("keeps a well-formed containerQuantity (the package's own total)", () => {
    const r = { ...base(), administration: { unit: "capsule", unitsPerServing: 1, suggestedUnits: 1, suggestedFrequency: "day", containerQuantity: 60 } } as ProposedTreatment;
    validate(r);
    expect(r.administration).toEqual({ unit: "capsule", unitsPerServing: 1, suggestedUnits: 1, suggestedFrequency: "day", containerQuantity: 60 });
  });

  it("drops a non-positive or non-numeric containerQuantity rather than storing it", () => {
    const r = { ...base(), administration: { unit: "capsule", unitsPerServing: 1, suggestedUnits: 1, suggestedFrequency: "day", containerQuantity: -1 } } as ProposedTreatment;
    validate(r);
    expect(r.administration).toEqual({ unit: "capsule", unitsPerServing: 1, suggestedUnits: 1, suggestedFrequency: "day" });
  });

  it("drops administration missing a unit, without throwing", () => {
    const r = { ...base(), administration: { suggestedUnits: 1, suggestedFrequency: "day" } } as unknown as ProposedTreatment;
    expect(() => validate(r)).not.toThrow();
    expect(r.administration).toBeUndefined();
  });

  it("drops administration with an invalid suggestedFrequency, without throwing", () => {
    const r = { ...base(), administration: { unit: "capsule", suggestedUnits: 1, suggestedFrequency: "twice daily" } } as unknown as ProposedTreatment;
    expect(() => validate(r)).not.toThrow();
    expect(r.administration).toBeUndefined();
  });

  it("a malformed administration never fails a good name/kind extraction", () => {
    const r = { ...base(), administration: "not an object" } as unknown as ProposedTreatment;
    expect(() => validate(r)).not.toThrow();
    expect(r.administration).toBeUndefined();
  });
});
