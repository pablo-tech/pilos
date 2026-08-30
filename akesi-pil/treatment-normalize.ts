import type {
  Client,
  ClientFactors,
  LegacyFactors,
  LegacyTreatmentItem,
  TreatmentItem,
  TreatmentKind,
} from "./types";

// Normalize free-text treatment dates to ISO `YYYY-MM` and fold pre-unification vaults
// (medications / supplements / plan) into the single `treatments` array. Pure, and shared by a
// one-time migration and the read-shim (treatmentsOf) alike, so both fold identically.

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
  nov: "11", november: "11", dec: "12", december: "12",
};

// A single date-ish token → YYYY-MM (or YYYY, or "" when there's no year to anchor it).
function parseOne(raw: string, fallbackYear?: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/^since\s+/, "");
  if (!cleaned) return "";
  const iso = cleaned.match(/(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  let month: string | undefined;
  let year: string | undefined;
  for (const tok of cleaned.split(/[\s,]+/).filter(Boolean)) {
    if (MONTHS[tok]) month = MONTHS[tok];
    else if (/^\d{4}$/.test(tok)) year = tok;
  }
  year ??= fallbackYear;
  if (!year) return "";
  return month ? `${year}-${month}` : year;
}

// Free-text date → { start, end? }. A closed window like "April–May 2026" (en/em dash — a hyphen
// is left to ISO) becomes start+end; a bare month/year becomes start only; prose ("TBD", "when HRV
// rises") yields an empty start.
export function parseSince(raw: string): { start: string; end?: string } {
  const s = (raw ?? "").trim();
  if (!s) return { start: "" };
  if (/^\d{4}(-\d{1,2}){0,2}$/.test(s)) return { start: parseOne(s) };
  const range = s.match(/^(.+?)\s*[–—]\s*(.+)$/);
  if (range) {
    const end = parseOne(range[2]);
    const start = parseOne(range[1], end.slice(0, 4) || undefined);
    return end ? { start, end } : { start };
  }
  return { start: parseOne(s) };
}

export function normalizeDate(raw: string): string {
  return parseSince(raw).start;
}

// Fold a (possibly legacy) factors object into the unified treatments array. Idempotent: if
// `treatments` already exists it is returned untouched, so a migrated vault is a no-op.
export function normalizeTreatments(factors: (ClientFactors & LegacyFactors) | undefined): TreatmentItem[] {
  if (!factors) return [];
  if (factors.treatments) return factors.treatments;
  const out: TreatmentItem[] = [];
  const fold = (items: LegacyTreatmentItem[] | undefined, kind: TreatmentKind) => {
    for (const it of items ?? []) {
      const name = (it.drug ?? "").trim();
      if (!name) continue;
      const { start, end } = parseSince(it.since ?? "");
      const t: TreatmentItem = { id: crypto.randomUUID(), name, kind, start };
      const dose = (it.dose ?? "").trim();
      if (dose) t.dose = dose;
      if (end) t.end = end;
      out.push(t);
    }
  };
  fold(factors.medications, "drug");
  fold(factors.supplements, "supplement");
  for (const p of factors.plan ?? []) {
    const name = (p.action ?? "").trim();
    if (!name) continue;
    // Plan actions are free prose — keep the whole string as a behavior name (no lossy name/dose
    // split); their prose date often won't parse, leaving start "". The migration CLI re-stamps
    // such rows to a future month so they read as PLANNED.
    out.push({ id: crypto.randomUUID(), name, kind: "behavior", start: normalizeDate(p.date ?? "") });
  }
  return out;
}

export function treatmentsOf(client: Client): TreatmentItem[] {
  return normalizeTreatments(client.factors as (ClientFactors & LegacyFactors) | undefined);
}
