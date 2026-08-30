import { describe, it, expect } from "vitest";
import { applyReportContribution, applySourceReadings, pruneOrphanImagingMarkers, diseaseKey } from "@pablotech/akesi-pil/report-merge";
import type { Client, MarkerResult, SourceRecord } from "@pablotech/akesi-pil/types";

function base(): Client {
  return { displayName: "Test", dob: "1980-01-01", gender: "male", watchlist: [], results: [], factors: { diseases: [] } };
}

function mr(marker: string, value: number, date: string, sourceId?: string, source = "Imaging"): MarkerResult {
  return { marker, group: "Imaging", source, date, value, unit: "", ...(sourceId ? { sourceId } : {}) };
}

describe("diseaseKey", () => {
  it("normalizes case, whitespace, separators, trailing punctuation", () => {
    expect(diseaseKey({ date: "2021-10-15", diagnostic: "Fatty liver." }))
      .toBe(diseaseKey({ date: "2021/10/15", diagnostic: "fatty   liver" }));
  });
});

describe("applyReportContribution — diseases", () => {
  it("adopts a provenance-less match instead of duplicating", () => {
    const c = base();
    c.factors!.diseases = [{ id: "d1", date: "2020-04-09", diagnostic: "CAC: 12; CAD-RADS 2 in the proximal RCA" }];
    const res = applyReportContribution(c, "src1", [
      { date: "2020-04-09", diagnostic: "cac: 12; cad-rads 2 in the proximal rca." },
    ], []);
    expect(res).toMatchObject({ diseasesAdded: 0, diseasesAdopted: 1 });
    expect(c.factors!.diseases).toHaveLength(1);
    expect(c.factors!.diseases![0].sourceId).toBe("src1");
  });

  it("preserves hand-entered and other sources' entries", () => {
    const c = base();
    c.factors!.diseases = [
      { id: "d2", date: "2000", diagnostic: "Hand entered" },
      { id: "d3", date: "2021", diagnostic: "From source X", sourceId: "srcX" },
    ];
    applyReportContribution(c, "src1", [{ date: "2019", diagnostic: "New finding" }], []);
    expect(c.factors!.diseases!.map((d) => d.diagnostic)).toEqual(["Hand entered", "From source X", "New finding"]);
  });

  it("carries icdCodes through to a new disease entry (header comorbidity)", () => {
    const c = base();
    applyReportContribution(c, "src1", [
      { date: "2026-06-15", diagnostic: "Coronary artery disease", icdCodes: ["I25.10"] },
    ], []);
    expect(c.factors!.diseases![0]).toMatchObject({ diagnostic: "Coronary artery disease", icdCodes: ["I25.10"], sourceId: "src1" });
  });

  it("stamps icdCodes onto an adopted provenance-less match", () => {
    const c = base();
    c.factors!.diseases = [{ id: "d4", date: "2026-06-15", diagnostic: "Hyperlipidemia" }];
    const res = applyReportContribution(c, "src1", [
      { date: "2026-06-15", diagnostic: "Hyperlipidemia", icdCodes: ["E78.5"] },
    ], []);
    expect(res).toMatchObject({ diseasesAdded: 0, diseasesAdopted: 1 });
    expect(c.factors!.diseases![0].icdCodes).toEqual(["E78.5"]);
  });

  it("folds a comorbidity code into a more-detailed same-date finding instead of adding a row", () => {
    const c = base();
    const res = applyReportContribution(c, "src1", [
      // finding first (caller order), comorbidity second
      { date: "2026-06-15", diagnostic: "Mitral valve prolapse with moderate regurgitation; MR grade 2", summary: "…" },
      { date: "2026-06-15", diagnostic: "Mitral valve prolapse", icdCodes: ["I34.1"] },
    ], []);
    expect(res).toMatchObject({ diseasesAdded: 1, comorbiditiesMerged: 1 });
    expect(c.factors!.diseases).toHaveLength(1);
    expect(c.factors!.diseases![0].icdCodes).toEqual(["I34.1"]);
  });

  it("keeps a comorbidity standalone when no finding covers its label", () => {
    const c = base();
    applyReportContribution(c, "src1", [
      { date: "2026-06-15", diagnostic: "Mildly enlarged left atrium (4.3 cm)", summary: "…" },
      { date: "2026-06-15", diagnostic: "Coronary artery disease", icdCodes: ["I25.10"] },
    ], []);
    expect(c.factors!.diseases!.map((d) => d.diagnostic)).toContain("Coronary artery disease");
    expect(c.factors!.diseases!.find((d) => d.diagnostic === "Coronary artery disease")!.icdCodes).toEqual(["I25.10"]);
  });

  it("is idempotent: re-applying keeps counts flat", () => {
    const c = base();
    const dis = [{ date: "2019-08-16", diagnostic: "Fatty liver" }];
    const mk = [mr("CAC score", 12, "2020-04-09", "src1")];
    applyReportContribution(c, "src1", dis, mk);
    const d1 = c.factors!.diseases!.length, m1 = c.results.length;
    applyReportContribution(c, "src1", dis, mk);
    expect(c.factors!.diseases!.length).toBe(d1);
    expect(c.results.length).toBe(m1);
  });
});

describe("applyReportContribution — markers", () => {
  it("adopts a provenance-less Imaging reading by marker|date", () => {
    const c = base();
    c.results = [mr("CAC score", 12, "2020-04-09")];
    const res = applyReportContribution(c, "src1", [], [mr("CAC score", 12, "2020-04-09", "src1")]);
    expect(res).toMatchObject({ markersAdded: 0, markersAdopted: 1 });
    expect(c.results[0].sourceId).toBe("src1");
  });

  it("does not adopt a non-imaging reading with the same marker|date", () => {
    const c = base();
    c.results = [mr("Glucose", 90, "2021-06-18", undefined, "Blood")];
    const res = applyReportContribution(c, "src1", [], [mr("Glucose", 90, "2021-06-18", "src1")]);
    expect(res.markersAdopted).toBe(0);
    expect(c.results[0].sourceId).toBeUndefined();
  });
});

describe("applyReportContribution — fromComparison precedence", () => {
  const G = "Aortic valve mean gradient";
  it("adds a fromComparison placeholder when nothing occupies the marker|date", () => {
    const c = base();
    const res = applyReportContribution(c, "src2", [], [{ ...mr(G, 10, "2021-10-08", "src2"), fromComparison: true }]);
    expect(res.markersAdded).toBe(1);
    expect(c.results).toHaveLength(1);
    expect(c.results[0].fromComparison).toBe(true);
  });

  it("skips a fromComparison placeholder when a real reading already exists", () => {
    const c = base();
    c.results = [mr(G, 10, "2021-10-08", "srcReal")];
    const res = applyReportContribution(c, "src2", [], [{ ...mr(G, 10, "2021-10-08", "src2"), fromComparison: true }]);
    expect(res.markersAdded).toBe(0);
    expect(c.results).toHaveLength(1);
    expect(c.results[0].sourceId).toBe("srcReal");
    expect(c.results[0].fromComparison).toBeUndefined();
  });

  it("lets a real reading oust an existing fromComparison placeholder", () => {
    const c = base();
    c.results = [{ ...mr(G, 10, "2021-10-08", "srcOld"), fromComparison: true }];
    const res = applyReportContribution(c, "src2", [], [mr(G, 11, "2021-10-08", "src2")]);
    expect(res.markersAdded).toBe(1);
    expect(c.results).toHaveLength(1);
    expect(c.results[0].value).toBe(11);
    expect(c.results[0].fromComparison).toBeUndefined();
    expect(c.results[0].sourceId).toBe("src2");
  });

  it("is idempotent: re-applying a placeholder keeps it a single row", () => {
    const c = base();
    const priors = [{ ...mr(G, 10, "2021-10-08", "src1"), fromComparison: true as const }];
    applyReportContribution(c, "src1", [], priors);
    applyReportContribution(c, "src1", [], priors);
    expect(c.results).toHaveLength(1);
    expect(c.results[0].fromComparison).toBe(true);
  });
});

function blood(marker: string, value: number, date: string, sourceId?: string): MarkerResult {
  return { marker, group: "Panel", source: "Blood", date, value, unit: "mg/dL", ...(sourceId ? { sourceId } : {}) };
}

describe("applySourceReadings (positional adoption)", () => {
  it("adopts a provenance-less match, adds new, leaves already-sourced alone", () => {
    const c = base();
    c.results = [
      blood("ApoB", 76, "2026-05-07"),            // provenance-less → adopt
      blood("LDL-C", 122, "2025-07-22", "srcOld"), // already sourced → leave
    ];
    const res = applySourceReadings(c, "src8", [
      blood("ApoB", 76, "2026-05-07"),
      blood("LDL-C", 122, "2025-07-22"),
      blood("Lp(a)", 30, "2026-05-07"),           // new → add
    ]);
    expect(res).toEqual({ added: 1, adopted: 1, updated: 0 });
    const byKey = Object.fromEntries(c.results.map((r) => [r.marker, r.sourceId]));
    expect(byKey["ApoB"]).toBe("src8");
    expect(byKey["LDL-C"]).toBe("srcOld");
    expect(byKey["Lp(a)"]).toBe("src8");
  });

  it("lets a real reading oust a fromComparison placeholder", () => {
    const c = base();
    c.results = [{ ...blood("Lp(a)", 30, "2026-05-07"), fromComparison: true }];
    const res = applySourceReadings(c, "src8", [blood("Lp(a)", 30, "2026-05-07")]);
    expect(res).toEqual({ added: 1, adopted: 0, updated: 0 });
    expect(c.results[0].fromComparison).toBeUndefined();
    expect(c.results[0].sourceId).toBe("src8");
  });

  it("is idempotent on re-run", () => {
    const c = base();
    const rows = [blood("ApoB", 76, "2026-05-07")];
    applySourceReadings(c, "src8", rows);
    const n = c.results.length;
    const res = applySourceReadings(c, "src8", rows);
    expect(c.results.length).toBe(n);
    expect(res).toEqual({ added: 0, adopted: 0, updated: 0 });
  });

  it("leaves an existing value untouched without refresh", () => {
    const c = base();
    c.results = [blood("ANA titer", 1, "2026-05-07", "src8")];
    const incoming: MarkerResult = { ...blood("ANA titer", 80, "2026-05-07"), unit: "titer", valueText: "1:40 to 1:80" };
    const res = applySourceReadings(c, "src8", [incoming]);
    expect(res).toEqual({ added: 0, adopted: 0, updated: 0 });
    expect(c.results[0].value).toBe(1);
    expect(c.results[0].valueText).toBeUndefined();
  });

  it("refresh=true rewrites value/unit/valueText on re-ingest, keeping sourceId", () => {
    const c = base();
    c.results = [blood("ANA titer", 1, "2026-05-07", "src8")];
    const incoming: MarkerResult = { ...blood("ANA titer", 80, "2026-05-07"), unit: "titer", valueText: "1:40 to 1:80" };
    const res = applySourceReadings(c, "src9", [incoming], true);
    expect(res).toEqual({ added: 0, adopted: 0, updated: 1 });
    expect(c.results[0].value).toBe(80);
    expect(c.results[0].unit).toBe("titer");
    expect(c.results[0].valueText).toBe("1:40 to 1:80");
    expect(c.results[0].sourceId).toBe("src8");
  });
});

describe("pruneOrphanImagingMarkers", () => {
  function withSource(id: string): SourceRecord {
    return { id, sha256: id, kind: "imaging", file: `sources/p/${id}.pdf`, originalName: "x.pdf", importedAt: "2026-01-01" };
  }
  it("drops provenance-less and dangling Imaging rows; keeps stamped + non-imaging", () => {
    const c = base();
    c.sources = [withSource("live")];
    c.results = [
      mr("EF", 60, "2021-01-01"),               // orphan: no sourceId
      mr("EF", 61, "2022-01-01", "dead"),       // dangling: source not in registry
      mr("EF", 62, "2023-01-01", "live"),       // valid
      mr("Glucose", 90, "2021-01-01", undefined, "Blood"), // non-imaging, untouched
    ];
    const pruned = pruneOrphanImagingMarkers(c);
    expect(pruned).toBe(2);
    expect(c.results.map((r) => r.marker + "|" + r.date)).toEqual(["EF|2023-01-01", "Glucose|2021-01-01"]);
  });
});
