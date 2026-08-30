// Whole-system unit conversion (US-conventional ↔ SI / metric), per reading.
//
// The selector picks a measurement SYSTEM, not just lb/kg: body metrics (lb/in ↔ kg/cm)
// AND lab analytes (mg/dL ↔ mmol/L, ng/mL ↔ nmol/L). Conversion is analyte-specific, so
// the molar table is keyed by marker NAME (the stable identity — there is no marker id).
//
// Design rules:
//  - Stored values stay AS-REPORTED (faithful to source). All conversion is on read.
//  - ANY marker may arrive in ANY unit, and one series may MIX units across dates. So
//    conversion is PER READING from that reading's own unit, and a mixed-unit series is
//    reconciled to a canonical (SI) unit before it is charted/aggregated (normalizeSeries).
//  - CLINICAL SAFETY: only analytes with a VERIFIED factor are converted; anything else
//    passes through in its stored unit, untouched, and is surfaced by `unmappedConvertible`
//    + the coverage-gate test. A missing conversion is safe; a wrong one is a clinical error.

export type UnitSystem = "metric" | "imperial"; // metric = SI, imperial = US-conventional

// ── Physical units (body metrics). Canonical = the metric base unit. ──────────────────
// metric unit → imperial display (factor: metric × factor = imperial).
export const PHYSICAL_TO_IMPERIAL: Record<string, { unit: string; factor: number }> = {
  kg: { unit: "lb", factor: 2.20462 },
  g: { unit: "lb", factor: 0.00220462 },
  cm: { unit: "in", factor: 0.393701 },
  "cm²": { unit: "in²", factor: 0.155 },
  "cm³": { unit: "in³", factor: 0.0610237 },
  mm: { unit: "in", factor: 0.0393701 },
  // Dimensionally exact (1 g/L = 100 mg/dL, no molar mass) → safe for ANY marker stored in
  // g/L (e.g. serum globulins); the SI side is g/L, the US/conventional side mg/dL.
  "g/L": { unit: "mg/dL", factor: 100 },
};
// imperial unit → metric canonical (for the rare case raw data arrives imperial).
const IMPERIAL_TO_METRIC: Record<string, { unit: string; factor: number }> = {
  lb: { unit: "kg", factor: 0.453592 },
  in: { unit: "cm", factor: 2.54 },
  "in²": { unit: "cm²", factor: 6.4516 },
  "in³": { unit: "cm³", factor: 16.387064 },
};

// M93 — markers where the metric unit IS the US-prevailing clinical convention, so the
// generic PHYSICAL_TO_IMPERIAL unit-keyed table must NOT convert them (e.g. visceral adipose
// tissue mass is reported in grams in US practice too, never ounces/lb — the owner's example,
// extended here to the sibling DEXA body-composition markers sharing the same convention).
// NEEDS VERIFICATION against a body-composition/DEXA clinical reference before relying on this
// beyond the owner-confirmed VAT case.
export const PHYSICAL_NO_CONVERT = new Set<string>([
  "Visceral adipose tissue mass",
  "Visceral adipose tissue area",
  "Visceral adipose tissue volume",
  "Subcutaneous adipose tissue area",
]);

// M93 — cosmetic unit-STRING variants for the same physical unit, straight from different lab
// source formats (values stay as-reported per the module doc above; only the DISPLAYED label is
// canonicalized, never the stored data). eGFR renders identically regardless of which lab
// formatted its unit string.
const UNIT_ALIAS: Record<string, string> = {
  "mL/min /1.73m2": "mL/min/1.73m²",
  "mL/min per 1.73 m2": "mL/min/1.73m²",
};
export function canonicalUnit(unit: string): string {
  return UNIT_ALIAS[unit] ?? unit;
}

// M93 — compound clinical units that are, on research, reported identically in US and SI/
// international practice — no US-customary form exists in routine use, so no conversion ever
// applies regardless of marker. NEEDS VERIFICATION against a clinical reference before treating
// as final; each entry's marker(s) are noted so a reviewer can check the specific convention.
export const VERIFIED_NO_CONVERT_UNITS = new Set<string>([
  "g/cm²", // DEXA bone mineral density (BMD)
  "kg/m²", // BMI-family indices (BMI, FMI, LMI, ALMI)
  "g/m²", // BMC/height²
  "cm²/m²", // aortic valve area index
  "ml/m²", // cardiac chamber volume indices (LA/RA volume index, LVOT stroke-volume index)
  "nmol/min/mL", // Lp-PLA2 activity (assay-specific, not a US/SI convention)
  "mL/min/1.73m²", // eGFR (canonical, post-alias)
]);

// ── Analyte molar units. Canonical = the SI side. `k` is conventional→SI: si = us × k. ──
// Each factor is a published clinical conversion; molar mass noted for audit.
export interface AnalyteRule {
  us: string; // US-conventional unit
  si: string; // SI unit (canonical)
  k: number; // us_value × k = si_value
}
export const ANALYTE: Record<string, AnalyteRule> = {
  // Lipid/glucose panel — mirrors the in-repo ingest table (parsers/healthmatters.ts
  // NORMALIZE, in production since W1); 1/k equals that table's factor (cross-checked by test).
  Glucose: { us: "mg/dL", si: "mmol/L", k: 1 / 18.02 }, // glucose MW 180.16
  "Estimated Average Glucose (eAG)": { us: "mg/dL", si: "mmol/L", k: 1 / 18.02 },
  "Total Cholesterol": { us: "mg/dL", si: "mmol/L", k: 1 / 38.67 }, // chol MW 386.65
  "HDL-C": { us: "mg/dL", si: "mmol/L", k: 1 / 38.67 },
  "LDL-C": { us: "mg/dL", si: "mmol/L", k: 1 / 38.67 },
  "Non-HDL Cholesterol": { us: "mg/dL", si: "mmol/L", k: 1 / 38.67 },
  "VLDL Cholesterol Cal": { us: "mg/dL", si: "mmol/L", k: 1 / 38.67 },
  Triglycerides: { us: "mg/dL", si: "mmol/L", k: 1 / 88.57 }, // triolein MW ~885
  "Apolipoprotein B": { us: "mg/dL", si: "g/L", k: 0.01 },
  "Apolipoprotein A-1": { us: "mg/dL", si: "g/L", k: 0.01 },
  // Core metabolic panel — standard factors, corroborated against clinical SI tables.
  "Creatinine, Serum": { us: "mg/dL", si: "µmol/L", k: 88.4 }, // creatinine MW 113.12
  "Creatinine, Random Urine": { us: "mg/dL", si: "µmol/L", k: 88.4 },
  "Calcium, Serum": { us: "mg/dL", si: "mmol/L", k: 0.2495 }, // Ca MW 40.08 (1/4.008)
  "Adjusted Calcium": { us: "mg/dL", si: "mmol/L", k: 0.2495 },
  "Uric Acid": { us: "mg/dL", si: "µmol/L", k: 59.48 }, // urate MW 168.11
  "Bilirubin Total": { us: "mg/dL", si: "µmol/L", k: 17.1 }, // bilirubin MW 584.66
  "Bilirubin Direct": { us: "mg/dL", si: "µmol/L", k: 17.1 },
  "Bilirubin Indirect": { us: "mg/dL", si: "µmol/L", k: 17.1 },
  "Vitamin D, 25-Hydroxy": { us: "ng/mL", si: "nmol/L", k: 2.496 }, // calcidiol MW 400.64
  // Endocrine, metabolic, vitamins/minerals — factors from the GlobalRPH conventional↔SI
  // table (a standard clinical reference; cross-checked against the search results). `us`
  // matches the EXACT stored unit string ("µg/dL" micro-sign vs "ug/dL" ASCII differ).
  Testosterone: { us: "ng/dL", si: "nmol/L", k: 0.0347 }, // testosterone MW 288.4
  "Testosterone, bioavailable (male)": { us: "ng/dL", si: "nmol/L", k: 0.0347 }, // same molecule
  "Free testosterone": { us: "pg/mL", si: "pmol/L", k: 3.47 }, // derived from testosterone MW (1000/288.4)
  "Estradiol (male)": { us: "pg/mL", si: "pmol/L", k: 3.671 },
  "Cortisol, Serum": { us: "µg/dL", si: "nmol/L", k: 27.59 },
  "Progesterone (male)": { us: "ng/mL", si: "nmol/L", k: 3.18 },
  "T4, Total (Thyroxine)": { us: "ug/dL", si: "nmol/L", k: 12.87 },
  "T4, Free": { us: "ng/dL", si: "pmol/L", k: 12.87 }, // stored SI (pmol/L)
  "IGF 1, LC/MS": { us: "ng/mL", si: "nmol/L", k: 0.131 },
  "C-Peptide, LC/MS/MS": { us: "ng/mL", si: "nmol/L", k: 0.333 },
  "Vitamin B12": { us: "pg/mL", si: "pmol/L", k: 0.738 },
  "Vitamin B9 (Folate)": { us: "ng/mL", si: "nmol/L", k: 2.266 },
  "Folate, RBC": { us: "ng/mL", si: "nmol/L", k: 2.266 },
  Iron: { us: "µg/dL", si: "µmol/L", k: 0.179 },
  "Total iron-binding capacity (TIBC)": { us: "ug/dL", si: "µmol/L", k: 0.179 },
  "UIBC Blood Test (Unsaturated Iron Binding Capacity)": { us: "µg/dL", si: "µmol/L", k: 0.179 },
  "Copper, Serum or Plasma": { us: "ug/dL", si: "µmol/L", k: 0.157 },
  Zinc: { us: "µg/dL", si: "µmol/L", k: 0.153 },
  Magnesium: { us: "mg/dL", si: "mmol/L", k: 0.411 }, // stored SI (mmol/L)
  "Magnesium, RBC": { us: "mg/dL", si: "mmol/L", k: 0.411 },
  "Phosphate (Phosphorus)": { us: "mg/dL", si: "mmol/L", k: 0.323 }, // stored SI (mmol/L)
  "Blood urea nitrogen (BUN)": { us: "mg/dL", si: "mmol/L", k: 0.357 }, // BUN → urea (SI)
  // Monovalent electrolytes: mEq/L (US) and mmol/L (SI) are numerically identical (valence 1).
  "Potassium, Serum (Kalium)": { us: "mEq/L", si: "mmol/L", k: 1 },
  "Sodium, Serum (Natrium)": { us: "mEq/L", si: "mmol/L", k: 1 },
  // M93 — urine albumin/creatinine ratio: US commonly reports mg/g creatinine; UK/Canada/
  // Australia and KDIGO's international staging table use mg/mmol creatinine. Factor derived
  // from creatinine MW 113.12 g/mol (1 g creatinine = 8.84 mmol, so mg/mmol = mg/g × 0.1131).
  // NEEDS VERIFICATION against a clinical reference before relying on this — flagged per the
  // owner's standing correctness concern, unlike the other factors above which are
  // cross-checked against the in-repo ingest table or a published clinical SI reference.
  "Albumin/Creatinine Ratio, Random Urine": { us: "mg/g creat", si: "mg/mmol creat", k: 0.1131 },
};

// The units that genuinely differ US↔SI, or need an explicit verified-non-convertible decision —
// used by the coverage gate to flag any (marker, unit) pair carrying one of these WITHOUT a rule
// (so a gap can never be silent). M93 extended this beyond molar-concentration units to the
// compound/physical units researched above.
export const CONVERTIBLE_UNIT_CLASS = new Set([
  "mg/dL", "ng/dL", "pg/mL", "µg/dL", "ug/dL", "mcg/dL", "ng/mL",
  "nmol/L", "pmol/L", "µmol/L", "umol/L", "mmol/L", "µg/ml", "ug/ml", "g/L", "mg/L",
  "mg/g creat",
  ...VERIFIED_NO_CONVERT_UNITS,
]);

export function recognizes(marker: string, unit: string): boolean {
  const u = canonicalUnit(unit);
  const a = ANALYTE[marker];
  if (a && (u === a.us || u === a.si)) return true;
  if (VERIFIED_NO_CONVERT_UNITS.has(u)) return true;
  return u in PHYSICAL_TO_IMPERIAL || u in IMPERIAL_TO_METRIC;
}

// Fold one reading to its canonical unit (analyte → SI; physical → metric base). An
// unrecognized unit is returned unchanged (never guessed).
export function toCanonical(marker: string, unit: string, value: number): { value: number; unit: string } {
  const u = canonicalUnit(unit);
  const a = ANALYTE[marker];
  if (a) {
    if (u === a.si) return { value, unit: a.si };
    if (u === a.us) return { value: value * a.k, unit: a.si };
    return { value, unit: u };
  }
  if (VERIFIED_NO_CONVERT_UNITS.has(u)) return { value, unit: u };
  const imp = IMPERIAL_TO_METRIC[u];
  if (imp) return { value: value * imp.factor, unit: imp.unit };
  return { value, unit: u }; // already metric, or system-invariant, or unknown
}

interface SeriesRow { marker: string; unit: string; value: number; valueText?: string; ref?: { low?: number; high?: number } }

// Reconcile a marker's readings to ONE unit. If the series is already single-unit, it is
// returned untouched (so the Finding/CLI basis is unchanged for today's single-unit data);
// only a genuinely mixed-unit series (e.g. an xls with both mg/dL and mmol/L) is folded to
// canonical so it can share one axis/scale and so deltas subtract like-for-like.
export function normalizeSeries<T extends SeriesRow>(rows: T[]): T[] {
  const units = new Set(rows.filter((r) => !r.valueText).map((r) => r.unit));
  if (units.size <= 1) return rows;
  return rows.map((r) => {
    if (r.valueText) return r;
    const c = toCanonical(r.marker, r.unit, r.value);
    if (c.unit === r.unit) return r;
    const ref = r.ref
      ? {
          low: r.ref.low != null ? toCanonical(r.marker, r.unit, r.ref.low).value : undefined,
          high: r.ref.high != null ? toCanonical(r.marker, r.unit, r.ref.high).value : undefined,
        }
      : undefined;
    return { ...r, value: c.value, unit: c.unit, ...(ref ? { ref } : {}) };
  });
}

// The convertible-class (marker, unit) pairs present in `rows` that have NO conversion rule.
// Powers the coverage-gate test and a dev console warning — unmapped analytes render in their
// stored unit, visibly tracked, never coerced.
export function unmappedConvertible(rows: { marker: string; unit: string }[]): { marker: string; unit: string }[] {
  const seen = new Map<string, { marker: string; unit: string }>();
  for (const r of rows) {
    if (!CONVERTIBLE_UNIT_CLASS.has(canonicalUnit(r.unit))) continue;
    if (recognizes(r.marker, r.unit)) continue;
    seen.set(`${r.marker}|${r.unit}`, { marker: r.marker, unit: r.unit });
  }
  return [...seen.values()].sort((a, b) => a.marker.localeCompare(b.marker));
}
