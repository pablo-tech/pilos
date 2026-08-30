import { describe, it, expect } from "vitest";
import { reportTitleOf, reportDateOf, REPORT_KIND_LABEL } from "@pablotech/akesi-pil/report-title";
import type { SourceRecord } from "@pablotech/akesi-pil/types";

const rec = (over: Partial<SourceRecord> = {}): SourceRecord =>
  ({ id: "s1", sha256: "x", kind: "lab", file: "f", originalName: "o.xlsx", importedAt: "2026-03-04T10:00:00Z", ...over }) as SourceRecord;

describe("report display helpers", () => {
  it("titles each kind", () => {
    expect(reportTitleOf(rec())).toBe("Blood panel");
    expect(reportTitleOf(rec({ kind: "dexa" }))).toBe("DEXA body composition");
    expect(reportTitleOf(rec({ kind: "scale" }))).toBe("Body composition (scale)");
    expect(reportTitleOf(rec({ kind: "imaging", studyType: "Echocardiogram" }))).toBe("Echocardiogram");
    expect(reportTitleOf(rec({ kind: "imaging" }))).toBe("Imaging study");
  });

  it("prefers studyDate, then the covered range, then the import day", () => {
    expect(reportDateOf(rec({ studyDate: "2026-01-01", dateEnd: "2026-02-02" }))).toBe("2026-01-01");
    expect(reportDateOf(rec({ dateEnd: "2026-02-02", dateStart: "2026-01-01" }))).toBe("2026-02-02");
    expect(reportDateOf(rec({ dateStart: "2026-01-01" }))).toBe("2026-01-01");
    expect(reportDateOf(rec())).toBe("2026-03-04");
  });

  it("labels every kind — the map is exhaustive by type, so adding one is a compile error", () => {
    expect(Object.keys(REPORT_KIND_LABEL).sort()).toEqual(["dexa", "imaging", "lab", "scale"]);
  });
});
