import type { Client, PersonalizedRange } from "./types";

export function resolveRange(marker: string, client: Client): PersonalizedRange | null {
  return client.personalizedRanges?.[marker] ?? null;
}

/**
 * A patient's age in whole years — THE implementation. Four more existed.
 *
 * Every copy used to read the DOB with LOCAL getters after parsing it as UTC. `new Date("2000-06-29")`
 * is midnight UTC; west of Greenwich `.getDate()` then answers 28. Measured, for a patient evaluated
 * the day before their birthday:
 *
 *     UTC                  25   (correct)
 *     America/Los_Angeles  26
 *     Asia/Tokyo           25
 *
 * This value goes into the clinical prompt, and age drives reference-range reasoning — so a patient's
 * stated age depended on which Cloudflare PoP served the request, or on the operator's laptop.
 *
 * Both sides are read in UTC now. A date of birth is a CALENDAR DATE, not an instant, and comparing
 * it against a local wall clock is the category error underneath this. UTC on both sides makes the
 * answer identical everywhere, which matters more here than matching any one operator's midnight:
 * the alternative is a number that silently differs between the browser, the CLI and a Worker.
 */
export function ageYears(dob: string, asOf: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  let age = asOf.getUTCFullYear() - d.getUTCFullYear();
  const m = asOf.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export interface Zones {
  safeLow: number;
  safeHigh: number;
  warnLowBound: number | null;
  warnHighBound: number | null;
  dangerLowBound: number | null;
  dangerHighBound: number | null;
}

// Independent per side: the safe zone is the personalized bound, falling back to the
// general bound, falling back to open-ended. A warn zone only exists where a personalized
// bound is stricter than its general counterpart (the gap between them); a danger zone only
// exists where a general bound is known (either as that gap's outer edge, or — with no
// personalized bound at all — directly at the general bound).
export function computeZones(
  personal: Pick<PersonalizedRange, "low" | "high" | "generalLow" | "generalHigh"> | null,
): Zones {
  const low = personal?.low;
  const high = personal?.high;
  const generalLow = personal?.generalLow;
  const generalHigh = personal?.generalHigh;

  const lowStricter = low != null && generalLow != null && low > generalLow;
  const lowDanger = lowStricter || (generalLow != null && (low == null || low <= generalLow));

  const highStricter = high != null && generalHigh != null && high < generalHigh;
  const highDanger = highStricter || (generalHigh != null && (high == null || high >= generalHigh));

  return {
    safeLow: low ?? generalLow ?? -Infinity,
    safeHigh: high ?? generalHigh ?? Infinity,
    warnLowBound: lowStricter ? generalLow! : null,
    warnHighBound: highStricter ? generalHigh! : null,
    dangerLowBound: lowDanger ? generalLow! : null,
    dangerHighBound: highDanger ? generalHigh! : null,
  };
}

export type ZoneStatus = "safe" | "warn" | "danger" | "unknown";

// The *current* reading's zone — unlike the retired markerStatus() trend signal, this only
// looks at the latest value, no history. Raw-value comparison, no unit conversion (mirrors
// markerStatus()'s pre-existing assumption that the row is already in the range's unit).
export function currentZoneStatus(latestValue: number | null, personal: PersonalizedRange | null): ZoneStatus {
  if (latestValue == null || personal == null) return "unknown";
  const z = computeZones(personal);
  if (latestValue >= z.safeLow && latestValue <= z.safeHigh) return "safe";
  const warnLow = z.warnLowBound ?? z.safeLow;
  const warnHigh = z.warnHighBound ?? z.safeHigh;
  if (latestValue >= warnLow && latestValue <= warnHigh) return "warn";
  return "danger";
}

const CONCERN_RANK: Record<ZoneStatus, number> = { danger: 0, warn: 1, safe: 2, unknown: 3 };

// Descending concern: danger < warn < safe < unknown (unknown/no-range sorts last).
export function concernRank(status: ZoneStatus): number {
  return CONCERN_RANK[status];
}
