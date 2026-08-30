import { describe, it, expect } from "vitest";
import { deltaForSeries, markerDeltas } from "@pablotech/akesi-pil/marker-deltas";
import type { Client, MarkerResult } from "@pablotech/akesi-pil/types";

function r(marker: string, date: string, value: number, unit = "mmHg"): MarkerResult {
  return { marker, group: "Echo", source: "Imaging", date, value, unit };
}

describe("deltaForSeries — mixed-unit series (W14)", () => {
  it("reconciles a US+SI series to one canonical unit before subtracting", () => {
    const d = deltaForSeries([
      { marker: "Glucose", group: "Blood", source: "Blood", date: "2024-01-01", value: 90, unit: "mg/dL" },
      { marker: "Glucose", group: "Blood", source: "Blood", date: "2026-01-01", value: 6, unit: "mmol/L" },
    ])!;
    expect(d.unit).toBe("mmol/L"); // canonical (SI)
    expect(d.latest.value).toBe(6);
    expect(d.prior.value).toBeCloseTo(90 / 18.02, 6); // 90 mg/dL folded to mmol/L
    expect(d.vsPrior.abs).toBeCloseTo(6 - 90 / 18.02, 6);
    expect(d.vsPrior.direction).toBe("up");
  });

  it("leaves a single-unit series in its stored unit (no Finding/CLI churn)", () => {
    const d = deltaForSeries([
      { marker: "Glucose", group: "Blood", source: "Blood", date: "2024-01-01", value: 90, unit: "mg/dL" },
      { marker: "Glucose", group: "Blood", source: "Blood", date: "2026-01-01", value: 100, unit: "mg/dL" },
    ])!;
    expect(d.unit).toBe("mg/dL");
    expect(d.vsPrior.abs).toBe(10);
  });
});

describe("deltaForSeries", () => {
  it("returns null for fewer than two readings", () => {
    expect(deltaForSeries([])).toBeNull();
    expect(deltaForSeries([r("Aortic valve mean gradient", "2021-01-01", 10)])).toBeNull();
  });

  it("computes vsPrior for a two-point series and omits a redundant baseline", () => {
    const d = deltaForSeries([
      r("Aortic valve mean gradient", "2021-01-01", 10),
      r("Aortic valve mean gradient", "2026-01-01", 14),
    ])!;
    expect(d.marker).toBe("Aortic valve mean gradient");
    expect(d.unit).toBe("mmHg");
    expect(d.prior.value).toBe(10);
    expect(d.latest.value).toBe(14);
    expect(d.vsPrior.abs).toBe(4);
    expect(d.vsPrior.pct).toBeCloseTo(40);
    expect(d.vsPrior.direction).toBe("up");
    // prior IS the baseline here — no duplicate vsBaseline
    expect(d.baseline).toBeUndefined();
    expect(d.vsBaseline).toBeUndefined();
  });

  it("sorts unsorted input by date before picking latest/prior/baseline", () => {
    const d = deltaForSeries([
      r("Ascending aorta diameter", "2026-01-01", 4.6, "cm"),
      r("Ascending aorta diameter", "2018-01-01", 3.1, "cm"),
      r("Ascending aorta diameter", "2021-01-01", 4.1, "cm"),
    ])!;
    expect(d.latest.value).toBe(4.6);
    expect(d.prior.value).toBe(4.1); // immediately before latest
    expect(d.baseline!.value).toBe(3.1); // first overall
    expect(d.vsPrior.abs).toBeCloseTo(0.5);
    expect(d.vsBaseline!.abs).toBeCloseTo(1.5);
    expect(d.vsBaseline!.direction).toBe("up");
  });

  it("computes a downward change and its span in days", () => {
    const d = deltaForSeries([
      r("LDL", "2025-01-01", 130, "mg/dL"),
      r("LDL", "2025-04-01", 90, "mg/dL"),
    ])!;
    expect(d.vsPrior.abs).toBe(-40);
    expect(d.vsPrior.direction).toBe("down");
    expect(d.vsPrior.pct).toBeCloseTo(-30.77, 1);
    expect(d.vsPrior.spanDays).toBe(90);
  });

  it("returns flat direction and null pct against a zero reference", () => {
    const d = deltaForSeries([
      r("CAC score", "2020-01-01", 0, "Agatston"),
      r("CAC score", "2024-01-01", 0, "Agatston"),
    ])!;
    expect(d.vsPrior.direction).toBe("flat");
    expect(d.vsPrior.abs).toBe(0);

    const up = deltaForSeries([
      r("CAC score", "2020-01-01", 0, "Agatston"),
      r("CAC score", "2024-01-01", 12, "Agatston"),
    ])!;
    expect(up.vsPrior.pct).toBeNull();
    expect(up.vsPrior.direction).toBe("up");
  });
});

describe("markerDeltas", () => {
  it("returns one entry per marker with ≥2 readings, sorted by name, skipping singletons", () => {
    const client = {
      results: [
        r("Aortic valve mean gradient", "2021-01-01", 10),
        r("Aortic valve mean gradient", "2026-01-01", 14),
        r("Ascending aorta diameter", "2021-01-01", 3.1, "cm"),
        r("Ascending aorta diameter", "2026-01-01", 4.6, "cm"),
        r("LVEF", "2026-01-01", 60, "%"), // single reading — excluded
      ],
    } as unknown as Client;
    const deltas = markerDeltas(client);
    expect(deltas.map((d) => d.marker)).toEqual([
      "Aortic valve mean gradient",
      "Ascending aorta diameter",
    ]);
  });
});
