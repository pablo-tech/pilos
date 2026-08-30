// Authored-date helpers. Dates entered in the app are ISO strings; legacy values were month-only
// (`YYYY-MM`, from the old month pickers). The convention: a partial date means the last day of that
// period (the agreed migration rule), so both display and comparison are deterministic.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Coerce a partial ISO date to the last day of its month/year: "2026-04" → "2026-04-30",
// "2026" → "2026-12-31". Full dates and "" pass through. Idempotent — safe to apply repeatedly.
export function endOfMonth(iso: string | undefined | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.trim().split("-");
  if (!y) return "";
  if (d) return iso.trim();
  if (!m) return `${y}-12-31`;
  // Day 0 of the next month is the last day of month `m` (1-based), so `new Date(y, m, 0)` — used
  // only to count days, never for display, so no timezone drift.
  const last = new Date(Number(y), Number(m), 0).getDate();
  return `${y}-${m.padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// Human, unambiguous date: "Apr 30, 2026". Partial values are coerced to end-of-month first. Parsed
// from the ISO string directly (not `new Date(iso)`), so it never drifts a day across timezones.
export function formatDay(iso: string | undefined | null): string {
  const full = endOfMonth(iso);
  if (!full) return "";
  const [y, m, d] = full.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

// M107 — a type="date" input fires `change` on every keystroke inside an already-plausible year
// segment, zero-padded (e.g. typing just "2" of "2026" reports "0002-08-15") — not only once the
// full year is typed. A plain truthiness/length check on `value` fires on that first padded digit.
// Require a 4-digit year that isn't itself a padding artifact (<1000) before treating it as done.
export function isCompleteDate(value: string): boolean {
  return !!value && Number(value.slice(0, 4)) >= 1000;
}
