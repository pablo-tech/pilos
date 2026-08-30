// Cross-study deltas (W2). The single source of truth for "what changed" — shared
// by a host's chart/print surfaces and by the Finding prompt builder here, so the change
// shown on screen and the change the model reasons over can never disagree.
//
// Grouping is by stored marker name, which is canonical post-W1c (imaging-catalog),
// so a metric is one series. `fromComparison` rows (W1b) are real datapoints here; a
// directly-measured reading at the same marker|date already won at ingest.

import type { Client, MarkerResult } from "./types";
import { normalizeSeries } from "./unit-systems";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Direction = "up" | "down" | "flat";

export interface DeltaChange {
  abs: number; // latest.value - reference.value, in the marker's stored unit
  pct: number | null; // percent change vs the reference; null when reference value is 0
  direction: Direction;
  spanDays: number; // days from the reference reading to the latest
}

export interface MarkerDelta {
  marker: string;
  unit: string;
  latest: MarkerResult;
  prior: MarkerResult; // the reading immediately before latest
  vsPrior: DeltaChange;
  // The first reading and the change against it — present only when the baseline is a
  // distinct datapoint from `prior` (≥3 readings or ≥2 distinct dates), so a two-point
  // series doesn't report the same change twice.
  baseline?: MarkerResult;
  vsBaseline?: DeltaChange;
}

function change(latest: MarkerResult, ref: MarkerResult): DeltaChange {
  const abs = latest.value - ref.value;
  const pct = ref.value !== 0 ? (abs / Math.abs(ref.value)) * 100 : null;
  const direction: Direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  const spanDays = Math.round(
    (new Date(latest.date).getTime() - new Date(ref.date).getTime()) / DAY_MS,
  );
  return { abs, pct, direction, spanDays };
}

// Delta for one marker's readings. `rows` need not be pre-sorted. Returns null when
// fewer than two readings exist (no change to report).
export function deltaForSeries(rows: MarkerResult[]): MarkerDelta | null {
  if (rows.length < 2) return null;
  // A mixed-unit series (e.g. an xls with both mg/dL and mmol/L) is reconciled to one
  // canonical unit so the subtraction is like-for-like; a single-unit series is untouched.
  const sorted = [...normalizeSeries(rows)].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];
  const baseline = sorted[0];
  const out: MarkerDelta = {
    marker: latest.marker,
    unit: latest.unit,
    latest,
    prior,
    vsPrior: change(latest, prior),
  };
  if (baseline.date !== prior.date) {
    out.baseline = baseline;
    out.vsBaseline = change(latest, baseline);
  }
  return out;
}

// Per-marker deltas across the whole vault. One entry per marker with ≥2 readings,
// sorted by marker name.
export function markerDeltas(client: Client): MarkerDelta[] {
  const byMarker = new Map<string, MarkerResult[]>();
  for (const r of client.results) {
    if (!byMarker.has(r.marker)) byMarker.set(r.marker, []);
    byMarker.get(r.marker)!.push(r);
  }
  const out: MarkerDelta[] = [];
  for (const rows of byMarker.values()) {
    const d = deltaForSeries(rows);
    if (d) out.push(d);
  }
  return out.sort((a, b) => a.marker.localeCompare(b.marker));
}
