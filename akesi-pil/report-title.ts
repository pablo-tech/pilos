// How a report is DISPLAYED — title, kind label, date — in one place.
//
// This logic used to be copy-pasted across five call sites (a sidebar helper, a reference resolver,
// a search index, and two UI components). `reportTitleOf` had already been extracted here and
// the copies simply never deleted; three of the five carried comments blessing the duplication that
// cited EACH OTHER as precedent. A plain module is importable from a UI component, a CLI and a
// server-side handler alike, so there was never a reason for a second copy.
import type { SourceRecord } from "./types";

// Keyed on SourceRecord["kind"], not Record<string, string>: reference-resolver's loose copy plus a
// `?? s.kind` fallback meant a NEW report kind compiled clean there and rendered its raw enum value
// to the user. Typed this way, adding a kind is a compile error until every label is supplied.
export const REPORT_KIND_LABEL: Record<SourceRecord["kind"], string> = {
  lab: "Lab",
  dexa: "DEXA",
  scale: "Scale",
  imaging: "Imaging",
};

/** The date a report is filed under: its study date, else the range it covers, else when it landed. */
export const reportDateOf = (s: SourceRecord): string =>
  s.studyDate ?? s.dateEnd ?? s.dateStart ?? s.importedAt.slice(0, 10);

export function reportTitleOf(s: SourceRecord): string {
  if (s.kind === "imaging") return s.studyType ?? s.extraction?.studyType ?? "Imaging study";
  if (s.kind === "dexa") return "DEXA body composition";
  if (s.kind === "scale") return "Body composition (scale)";
  return "Blood panel";
}
