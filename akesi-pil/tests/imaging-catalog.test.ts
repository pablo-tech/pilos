import { describe, it, expect } from "vitest";
import { canonicalImagingMarker, isKnownImagingMarker, CANONICAL_IMAGING_MARKERS } from "@pablotech/akesi-pil/imaging-catalog";

describe("canonicalImagingMarker", () => {
  it("collapses LVEF phrasings to one canonical name", () => {
    const c = "Left ventricular ejection fraction (LVEF)";
    expect(canonicalImagingMarker("LV Ejection Fraction (Biplane Simpson)")).toBe(c);
    expect(canonicalImagingMarker("LV Ejection Fraction (Biplane Simpson's)")).toBe(c);
    expect(canonicalImagingMarker("Left ventricular ejection fraction (biplane Simpson)")).toBe(c);
    expect(canonicalImagingMarker("LVEF")).toBe(c);
  });

  it("normalizes pure case/spacing/dash variants of a canonical name", () => {
    expect(canonicalImagingMarker("aortic   root  diameter")).toBe("Aortic root diameter");
    expect(canonicalImagingMarker("E/A Ratio")).toBe("E/A ratio");
    expect(canonicalImagingMarker("CAC score - Left main")).toBe("CAC score — left main");
  });

  it("maps known aliases (size→length, mid ascending→ascending)", () => {
    expect(canonicalImagingMarker("Right kidney size")).toBe("Right kidney length");
    expect(canonicalImagingMarker("Mid ascending aorta diameter")).toBe("Ascending aorta diameter");
    expect(canonicalImagingMarker("Post-void residual")).toBe("Post-void residual volume");
  });

  it("passes an unknown marker through unchanged (trimmed)", () => {
    expect(canonicalImagingMarker("  Splenic vein diameter ")).toBe("Splenic vein diameter");
  });

  it("every canonical name maps to itself", () => {
    for (const c of CANONICAL_IMAGING_MARKERS) expect(canonicalImagingMarker(c)).toBe(c);
  });

  it("canonicalizes this echo's markers (AVA, AVA-index, peak gradient, E/e′, LVOT SVi, LV mass)", () => {
    expect(canonicalImagingMarker("AVA")).toBe("Aortic valve area");
    expect(canonicalImagingMarker("AVA index")).toBe("Aortic valve area index");
    expect(canonicalImagingMarker("Aortic valve area indexed")).toBe("Aortic valve area index");
    expect(canonicalImagingMarker("Peak gradient")).toBe("Aortic valve peak gradient");
    expect(canonicalImagingMarker("E/e′ average")).toBe("E/e′ average");
    expect(canonicalImagingMarker("E/e prime average")).toBe("E/e′ average");
    expect(canonicalImagingMarker("LVOT SVi")).toBe("LVOT stroke-volume index");
    expect(canonicalImagingMarker("LV mass")).toBe("Left ventricular mass");
    expect(canonicalImagingMarker("LAVi")).toBe("Left atrial volume index");
  });

  it("isKnownImagingMarker is true for catalog/alias names, false for novel ones", () => {
    expect(isKnownImagingMarker("Aortic valve area")).toBe(true);
    expect(isKnownImagingMarker("AVA")).toBe(true);
    expect(isKnownImagingMarker("LV Ejection Fraction (Biplane Simpson)")).toBe(true);
    expect(isKnownImagingMarker("Splenic vein diameter")).toBe(false);
  });
});
