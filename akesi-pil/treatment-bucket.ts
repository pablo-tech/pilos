import type { Client, TreatmentItem } from "./types";
import { formatDay } from "./dates";

// This module previously imported UI-framework sidebar helpers for a small tail of rendering logic,
// which pinned the whole of it — bucketing, dose formatting, assessment lookup, all pure clinical
// logic — to a host app's UI layer. That tail now lives in a host-side module and this file imports
// no UI, so it stays importable from any runtime.

// A treatment's temporal bucket is DERIVED from its start/optional-end, never stored.
// `today` is ALWAYS passed in as an ISO `YYYY-MM` (or longer ISO, compared by prefix) so this
// stays pure and testable — never read the clock inside (feedback_finding_date_awareness).

export type Bucket = "past" | "ongoing" | "planned";

// M102 Phase 1 — the display label for a bucket badge (Treatment's Ungrouped view, which
// otherwise concatenates all three buckets with no other visual distinction).
export const BUCKET_LABEL: Record<Bucket, string> = { ongoing: "Ongoing", planned: "Planned", past: "Past" };

// Day-precision ISO date. Callers compute this at the boundary (new Date()) and pass it down.
export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Compare two partial ISO dates ("2026", "2026-04", "2026-04-01") by their common prefix length,
// so a year-only value sorts sensibly against a month value. Empty strings sort earliest. Exported
// for a host's edit model, which needs the same mixed-precision-safe ordering to sort same-name
// titration rows within Ongoing/Planned/Past newest-first.
export function cmp(a: string, b: string): number {
  const n = Math.min(a.length, b.length) || Math.max(a.length, b.length);
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  return x < y ? -1 : x > y ? 1 : 0;
}

// end in the past → past; start in the future → planned; otherwise (started, or start unknown,
// and not ended) → ongoing. `today` may be YYYY-MM or YYYY-MM-DD; comparison is prefix-wise, so a
// day-precision `today` against a legacy month-only start/end degrades gracefully to month-level.
export function bucketOf(t: Pick<TreatmentItem, "start" | "end">, today: string): Bucket {
  if (t.end && cmp(t.end, today) < 0) return "past";
  if (t.start && cmp(t.start, today) > 0) return "planned";
  return "ongoing";
}

// The right-aligned row meta, phrased by bucket with dates rendered as a clear day (legacy month-only
// values read as the last day of that month). Past shows a "start – end" range; a hyphen-free en-dash
// separator with day-bearing dates avoids the old "2026-04–2026-05" blur.
export function treatmentMeta(t: Pick<TreatmentItem, "start" | "end">, bucket: Bucket): string | undefined {
  if (bucket === "past") {
    return t.start ? `${formatDay(t.start)} – ${formatDay(t.end)}` : `until ${formatDay(t.end)}`;
  }
  if (bucket === "planned") return t.start ? `planned for ${formatDay(t.start)}` : "planned";
  return t.start ? `since ${formatDay(t.start)}` : undefined;
}

// Titration is encoded as repeated same-name rows (feedback_treatment_titration_rows). Collapse to
// one representative per name: earliest start, latest dose, latest end (only past if the latest row
// ended). Preserves kind from the first row. Sorted by name for a stable order.
export function collapseByName(items: TreatmentItem[]): TreatmentItem[] {
  const byName = new Map<string, TreatmentItem[]>();
  for (const it of items) {
    const key = it.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(it);
  }
  const out: TreatmentItem[] = [];
  for (const rows of byName.values()) {
    const byStart = [...rows].sort((a, b) => cmp(a.start || "", b.start || ""));
    const latest = byStart[byStart.length - 1];
    const ends = rows.map((r) => r.end).filter((e): e is string => !!e);
    // A collapsed treatment is only "ended" if the most recent dose row has an end; a superseded
    // earlier row's end (the next titration step's start) does not end the treatment.
    const collapsed: TreatmentItem = {
      id: latest.id,
      name: latest.name,
      dose: latest.dose,
      // M104 — carry the structured dose fields through too, same "latest row wins" rule as `dose`
      // itself; formatDose() prefers these over `dose`, so dropping them here would silently blank
      // out any collapsed-view display for a titration step entered through the new Amount/Unit form.
      doseAmount: latest.doseAmount,
      doseUnit: latest.doseUnit,
      doseFrequency: latest.doseFrequency,
      kind: rows[0].kind,
      start: byStart[0].start,
      // Carry the most-recent titration row's attachments through; previously dropped
      // entirely here, so the read-only view (TreatmentRow, which reads off this collapsed shape)
      // never showed a treatment's photos even though the editable view (which reads uncollapsed
      // draft rows directly) did.
      images: latest.images,
      attachments: latest.attachments,
      // The product fields describe the DRUG, so they survive collapsing like name/kind do — and
      // they are taken from rows[0] rather than `latest` because a medicine-scope save fans the
      // same values across every row anyway. This whitelist has needed extending more than once
      // (attachments, structured dose, administration): anything omitted here works in
      // the editor and is invisible in TreatmentRow, chat-context, search-index and
      // reference-resolver.
      description: rows[0].description,
      maker: rows[0].maker,
      ingredients: rows[0].ingredients,
      links: rows[0].links,
      administration: rows[0].administration,
    };
    if (latest.end && ends.length) collapsed.end = ends.sort(cmp)[ends.length - 1];
    out.push(collapsed);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface NamedTreatmentGroup {
  name: string;
  rows: TreatmentItem[];
}

// M108 — primary group order: Planned drugs first, then Ongoing, then Past — recency of use. A
// group's bucket is its NEWEST row's (rows[0], already sorted descending below), so a drug
// currently mid-titration reads as Ongoing even if an older row of the same drug once looked
// Planned. M109 — within one bucket, groups sort alphabetically (secondary key), not entry order.
const GROUP_BUCKET_ORDER: Record<Bucket, number> = { planned: 0, ongoing: 1, past: 2 };

// M103 — the Medicine audit view's grouping: every raw row for a drug together, unlike
// collapseByName which discards all but one representative row per name.
//
// M105 — rows sorted newest-first (start descending): the table must always read newest-to-oldest,
// top to bottom. dateGaps() below is written against this same descending order.
export function groupByName(items: TreatmentItem[], today: string): NamedTreatmentGroup[] {
  const byName = new Map<string, TreatmentItem[]>();
  for (const it of items) {
    const key = it.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(it);
  }
  const groups = [...byName.values()].map((rows) => ({
    name: rows[0].name,
    rows: [...rows].sort((a, b) => cmp(b.start || "", a.start || "")),
  }));
  return groups.sort((a, b) => {
    const bucketDiff = GROUP_BUCKET_ORDER[bucketOf(a.rows[0], today)] - GROUP_BUCKET_ORDER[bucketOf(b.rows[0], today)];
    return bucketDiff !== 0 ? bucketDiff : a.name.localeCompare(b.name);
  });
}

export type DateGapVerdict = "ok" | "gap" | "overlap";

// M104 — whole-day distance between two full YYYY-MM-DD dates (nextStart - end), or null if
// either isn't full day precision (legacy month/year-only can't do calendar-day arithmetic).
function daysBetween(a: string, b: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// M103 — one verdict per consecutive pair in an already-sorted `rows` (see groupByName), comparing
// the OLDER row's end against the NEWER row's start: no end (still ongoing) or an unknown start
// can't be judged, so those read "ok" rather than a false positive. Length is rows.length - 1.
//
// M104 — a titration step ending 2026-06-30 with the next starting 2026-07-01 is back-to-back
// coverage, not a gap: prefer day-precision arithmetic (0 or 1 day apart both read "ok") over the
// cmp() prefix comparison, which only recognized an exact same-day handoff as contiguous. Falls
// back to cmp() when either date isn't full day precision.
//
// M105 — `rows` is newest-first (groupByName sorts descending), so for the pair at (i, i+1), i+1
// is the OLDER row and i is the NEWER one — verdict[i] describes the gap/overlap between them.
//
// M106 — symmetric with the gap side: a 1-day overlap (the newer row starts the day before the
// older one's recorded end — a rounding/entry-day wobble, not a real double-dosing period) also
// reads "ok". Only a 2+ day overlap is worth flagging. This only applies to the day-precision
// branch — the cmp() fallback (month/year-only dates) has no day-scale magnitude to be lenient about.
//
// M110 — an AM row and a PM row covering the same dates aren't double-dosing, they're a twice-daily
// split — only downgrades a would-be "overlap" (a real gap between an AM and a PM step is still a
// gap; this isn't a blanket "ignore timing" exemption).
function splitByTiming(a: TreatmentItem, b: TreatmentItem): boolean {
  return !!a.timingPeriod && !!b.timingPeriod && a.timingPeriod !== b.timingPeriod;
}

export function dateGaps(rows: TreatmentItem[]): DateGapVerdict[] {
  const out: DateGapVerdict[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const newer = rows[i];
    const older = rows[i + 1];
    const olderEnd = older.end;
    const newerStart = newer.start;
    if (!olderEnd || !newerStart) {
      out.push("ok");
      continue;
    }
    const days = daysBetween(olderEnd, newerStart);
    let verdict: DateGapVerdict;
    if (days !== null) {
      verdict = days < -1 ? "overlap" : days <= 1 ? "ok" : "gap";
    } else {
      const c = cmp(olderEnd, newerStart);
      verdict = c < 0 ? "gap" : c > 0 ? "overlap" : "ok";
    }
    out.push(verdict === "overlap" && splitByTiming(newer, older) ? "ok" : verdict);
  }
  return out;
}

// The verbatim label a PLANNED treatment presents to the Finding (Patient Plan Action, treatmentGroups
// patient ref, planAssessmentRows key) — its name plus dose when present. Must be identical everywhere
// the ref is matched (finding-generate input block, finding-assemble expected set, treatment-groups resolve).
// M104 — the display string for a dose: structured amount/unit/frequency when the record has been
// entered/edited through the new form, reproducing the pre-existing "6mg/week" convention so
// treatmentLabel()'s output (and everything matched against it) doesn't change shape; falls back to
// the legacy free-text `dose` string for anything a host has not yet migrated.
export function formatDose(t: Pick<TreatmentItem, "dose" | "doseAmount" | "doseUnit" | "doseFrequency">): string | undefined {
  if (t.doseAmount != null) {
    const unit = t.doseUnit?.trim() ?? "";
    const freq = t.doseFrequency ? `/${t.doseFrequency}` : "";
    return `${t.doseAmount}${unit}${freq}`;
  }
  return t.dose?.trim() || undefined;
}

export function treatmentLabel(t: Pick<TreatmentItem, "name" | "dose" | "doseAmount" | "doseUnit" | "doseFrequency">): string {
  const name = t.name.trim();
  const dose = formatDose(t);
  return dose ? `${name} ${dose}` : name;
}

// Shared by a host's display and by any backfill over the same records — it must stay a single
// implementation, so "does this row have an assessment" cannot silently disagree between what a
// reader is shown and what a backfill decides is missing.
//
// `treatmentAssessment`'s targetLabels scope on the model's own dose-annotated "item" label (e.g.
// "Rosuvastatin 20 mg"), not the raw treatment name — matching a bare name against that requires
// a substring check,
// falling back to just the first word so "Magnesium Glycinate" still matches an item recorded as
// "Magnesium glycinate 1.5g/day elemental".
export function matchOngoingAssessment<T extends { item: string; assessment: string }>(
  assessments: T[],
  name: string,
  used?: Set<object>,
): T | undefined {
  return matchByTreatmentName(assessments, name, (t) => t.item, used);
}

/**
 * The PLANNED twin, and the reason this was extracted.
 *
 * The planned card used an exact `Map.get(treatmentLabel(row))` — "Tirzepatide 10.5mg/week" — while
 * the model records the action under whatever label it was given, which for a real case was the
 * bare "Tirzepatide". The lookup missed, so the card read "No assessment available" while a
 * perfectly good assessment existed, and every regeneration "failed silently": the regen succeeded,
 * the merge succeeded, and nothing appeared. The ongoing path had tolerated exactly this for a long
 * time; only the planned path was strict, and the asymmetry was invisible because both sides looked
 * reasonable.
 */
export function matchPlanAssessment<T extends { action: string; assessment: string }>(
  rows: T[],
  name: string,
  used?: Set<object>,
): T | undefined {
  return matchByTreatmentName(rows, name, (r) => r.action, used);
}

// A stored label may carry a dose annotation the model wrote ("Rosuvastatin 20 mg") or may be the
// bare name; the treatment it belongs to may likewise be looked up either way. Match on containment
// in whichever direction, then fall back to the first word so "Magnesium Glycinate" still finds
// "Magnesium glycinate 1.5g/day elemental".
// `used` is an optional index set the caller owns: when a whole list of treatments is matched in one
// pass (TreatmentRow), one assessment must not be attributed to two different drugs. The card path
// matches a single name and passes nothing. Merging the two implementations this way is the point —
// treatment-bucket's had the reverse-containment tier, TreatmentRow's had the exclusion set, and each
// was missing what the other had.
export function matchByTreatmentName<T extends object>(
  entries: T[],
  name: string,
  keyOf: (e: T) => string,
  used?: Set<object>,
): T | undefined {
  const d = name.trim().toLowerCase();
  if (!d) return undefined;
  const w = d.split(/\s+/)[0];
  const free = (e: T) => !used?.has(e);
  const key = (e: T) => keyOf(e).toLowerCase().trim();
  const found =
    entries.find((e) => free(e) && key(e).includes(d))
    ?? entries.find((e) => free(e) && d.includes(key(e)))
    ?? entries.find((e) => free(e) && key(e).includes(w));
  if (!found) return undefined;
  used?.add(found);
  return found;
}

export interface ResolvedAssessment {
  assessment: string;
  group?: string;
}

/**
 * THE assessment lookup — every surface goes through this one, per (drug, phase).
 *
 * A drug can now hold up to three assessments, one per phase, so a Past card no longer renders the
 * text written about the current dose. The resolution order is what keeps that migration free:
 *
 *   1. an entry for this exact phase — the new shape;
 *   2. a PHASE-LESS entry — everything stored before this existed, still shown under every bucket
 *      exactly as it was, until that drug is next translated;
 *   3. for planned only, the legacy planAssessmentRows store, which the leaf path no longer writes.
 *
 * Having one function is the other half of the point. The same lookup was written four times with
 * three different behaviours; a bug fixed in the card (a strict Map.get that silently found nothing)
 * stayed live in the read-only path and in the CLI backfill.
 */
export function assessmentFor(
  finding: Client["finding"] | undefined,
  name: string,
  phase: Bucket,
  used?: Set<object>,
  treatmentId?: string,
): ResolvedAssessment | undefined {
  const entries = finding?.treatment ?? [];
  const phased = entries.filter((e) => e.phase === phase);

  // An exact id match first, and it ends the search. Everything below this line is
  // substring-guessing against a name the MODEL wrote (dose included), which is what the id replaces:
  // three ordered `includes` rules, a `used` set to stop one row being claimed by two drugs, and a
  // rename that splices into the stored string. A row that carries an id needs none of it.
  //
  // The fallback stays because a finding written before ids existed has none, and re-running the leaf
  // for every patient to migrate them would cost a full generation each. A row upgrades itself the
  // next time its drug is reassessed.
  if (treatmentId) {
    const byId = phased.find((e) => e.treatmentId === treatmentId && !used?.has(e));
    if (byId) {
      used?.add(byId);
      return { assessment: byId.assessment, group: byId.group };
    }
  }

  // Never let a name rule claim a row that is id-keyed for a DIFFERENT treatment: once a row says
  // which drug it is about, a substring coincidence must not override it.
  const nameable = phased.filter((e) => !e.treatmentId || e.treatmentId === treatmentId);
  const hit = matchByTreatmentName(nameable, name, (e) => e.item, used);
  if (hit) return { assessment: hit.assessment, group: hit.group };

  const legacyEntries = entries.filter((e) => !e.phase && (!e.treatmentId || e.treatmentId === treatmentId));
  const legacy = matchByTreatmentName(legacyEntries, name, (e) => e.item, used);
  if (legacy) return { assessment: legacy.assessment, group: legacy.group };

  if (phase !== "planned") return undefined;
  const row = matchPlanAssessment(finding?.planAssessmentRows ?? [], name);
  return row ? { assessment: row.assessment } : undefined;
}

/**
 * Re-keys stored assessments when a medicine is renamed, in place.
 *
 * finding.treatment[] entries are matched to a medicine BY NAME (matchOngoingAssessment above), so a
 * rename orphans them: the turn is still stored, under a name nothing looks up any more, and the card
 * reads "No assessment available" the instant the rename is saved. Carrying the item forward keeps
 * the previous turn on screen — marked stale by the hash, and replaced as soon as the regen lands —
 * which matters most exactly when that regen fails.
 */
export function renameAssessmentItems<T extends { item: string }>(entries: T[], prevName: string, nextName: string): void {
  const prev = prevName.trim();
  const next = nextName.trim();
  if (!prev || !next || prev.toLowerCase() === next.toLowerCase()) return;
  for (const e of entries) {
    const i = e.item.toLowerCase().indexOf(prev.toLowerCase());
    if (i < 0) continue;
    // Splice rather than replace the whole string: the stored item carries a dose annotation the
    // model wrote ("Rosuvastatin 20 mg"), and only the name part is being renamed.
    e.item = e.item.slice(0, i) + next + e.item.slice(i + prev.length);
  }
}
