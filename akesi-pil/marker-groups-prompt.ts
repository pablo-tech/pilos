// Isomorphic marker->body-system prompt/schema + multi-pass convergence loop, so a Node caller
// and a zero-knowledge web path can share one implementation. The actual model call stays with
// each caller (an SDK singleton vs a runtime-bound key) — this module only builds requests and
// reconciles responses, injected via `callModel`.
import type { Client } from "./types";
import { UNCATEGORIZED } from "./system-groups";

export const GROUPS_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          group: { type: "string" },
          markers: { type: "array", items: { type: "string" } },
        },
        required: ["group", "markers"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;

export interface GroupsAIResponse {
  groups: { group: string; markers: string[] }[];
}

// The full marker universe to place: every distinct marker with data, plus any
// watchlisted marker that has no reading yet (so it still gets a home).
export function distinctMarkerNames(client: Client): string[] {
  const names = new Set<string>();
  for (const r of client.results) names.add(r.marker);
  for (const m of client.watchlist) names.add(m);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// cyrb53 — a small, non-cryptographic, deterministic string hash (this is a cache/staleness
// key, not a security boundary, so no need for node:crypto: that import isn't available in
// the browser, and this module is isomorphic — shared by the client, the Workers Function, and
// the Node ingest script). https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Hash over BOTH the marker set and the disease-group set: a new marker or a changed System
// Analysis both invalidate the grouping.
export function markerGroupsHashOf(markerNames: string[], systemGroups: string[]): string {
  const a = [...markerNames].sort().join("\n");
  const b = [...systemGroups].sort().join("\n");
  return cyrb53(`${a}␞${b}`).toString(16).padStart(12, "0").slice(0, 12);
}

export const SYSTEM_PROMPT = [
  "You assign a patient's lab/biometric markers to the patient's own body systems",
  "(the AI Finding's disease areas), so each marker is read alongside the others",
  "that speak to the same underlying system. This is cross-source: a marker may come",
  "from bloodwork, a scan, or a body-composition scale — assign by what it MEANS",
  "clinically, not by the panel or device it came from (e.g. an aortic-root diameter",
  "and ApoB both belong to Cardiovascular Risk; Android % Fat belongs to Body",
  "Composition).",
  "",
  "You are given the patient's BODY SYSTEMS. Assign EVERY marker to EXACTLY ONE of",
  "them, using the system name VERBATIM — never rename, merge, abbreviate, or invent",
  "a system. If a marker genuinely fits none of the listed systems, place it in a",
  `group named exactly "${UNCATEGORIZED}". Reply with strict JSON matching the schema.`,
  "",
  "Rules:",
  "- Output EVERY provided marker exactly once — none omitted, none invented, names",
  "  verbatim. The total marker count across your groups MUST equal the number given.",
  "- EVERY listed name is a DISTINCT marker you must place, even when it closely",
  "  resembles another one. A free vs total, a percentage vs mass vs area, a ratio vs",
  "  its components, a high-sensitivity vs standard assay, a per-segment vs whole-body",
  "  measure are DIFFERENT markers — place ALL of them (e.g. Apolipoprotein B, Apo B :",
  "  Apo A-1, and Apolipoprotein A-1 are three separate Cardiovascular markers; hsCRP",
  "  and CRP are both Inflammation; Free testosterone and Testosterone are both",
  "  Hormonal). NEVER drop a marker as redundant.",
  "- Every group name MUST be one of the listed body systems verbatim, or the literal",
  `  "${UNCATEGORIZED}". Do not create any other group name.`,
  "- Put each marker in the SINGLE system where observing it next to its group-mates",
  "  is most informative for this patient.",
  "- Within a group, order markers from most to least central to the system.",
].join("\n");

export function contextBlock(client: Client, markers: string[], leftover: boolean): string {
  const lines: string[] = [];
  const valueByMarker = new Map<string, string>();
  for (const r of [...client.results].sort((a, b) => a.date.localeCompare(b.date))) {
    valueByMarker.set(r.marker, r.valueText ?? `${r.value} ${r.unit}`.trim());
  }
  const watch = new Set(client.watchlist);

  lines.push("BODY SYSTEMS (assign every marker to one of these, verbatim):");
  for (const d of client.finding?.disease ?? []) {
    const gist = (d.finding ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
    lines.push(`  - ${d.group}${gist ? ` — ${gist}` : ""}`);
  }

  lines.push(
    leftover
      ? "\nThese markers were NOT assigned on the first pass. EVERY marker below belongs to" +
        " one of the systems above — assign each to its SINGLE CLOSEST system. Every listed" +
        " marker MUST appear under exactly one body system. Do NOT output a" +
        ` "${UNCATEGORIZED}" group — it is not permitted in this response; if a marker seems` +
        " to fit no system, choose the one it relates to most (every marker relates to some" +
        " system — e.g. a red-cell index relates to the system its anemia/pathology bears on):"
      : "\nMARKERS TO ASSIGN (place every one of these exactly once):",
  );
  for (const m of markers) {
    const v = valueByMarker.get(m);
    const w = watch.has(m) ? " [watchlist]" : "";
    lines.push(`  - ${m}${w}${v ? ` (latest ${v})` : " (no data on file)"}`);
  }

  const studies = leftover ? [] : client.study?.entries ?? [];
  if (studies.length > 0) {
    lines.push("\nPURSUED STUDIES (assignment hints):");
    for (const s of studies) lines.push(`  - ${s.focus}: ${s.detail}`);
  }
  return lines.join("\n");
}

// Reconcile the model's grouping against the real marker set and the allowed body
// systems: keep only real markers, keep only verbatim-system group names (an
// invented/renamed group has its markers swept), dedupe (first placement wins),
// and sweep any unplaced marker into a trailing "Not yet categorized" group so
// coverage is exactly-once and complete.
export function reconcileGroups(
  markerNames: string[],
  systemGroups: string[],
  raw: { group: string; markers: string[] }[],
): { group: string; markers: string[] }[] {
  const want = new Set(markerNames);
  const allowed = new Set(systemGroups);
  const placed = new Set<string>();
  const out: { group: string; markers: string[] }[] = [];
  for (const g of raw) {
    const name = (g.group ?? "").trim();
    if (name !== UNCATEGORIZED && !allowed.has(name)) continue; // reject non-verbatim systems
    const markers = (g.markers ?? []).filter((m) => want.has(m) && !placed.has(m));
    markers.forEach((m) => placed.add(m));
    if (markers.length > 0) out.push({ group: name, markers });
  }
  const leftover = markerNames.filter((m) => !placed.has(m));
  if (leftover.length > 0) {
    const existing = out.find((g) => g.group === UNCATEGORIZED);
    if (existing) existing.markers.push(...leftover);
    else out.push({ group: UNCATEGORIZED, markers: leftover });
  }
  return out;
}

export type CallModel = (markers: string[], leftover: boolean) => Promise<{ group: string; markers: string[] }[]>;

// The absorb/completeness-round loop: accumulate marker->system placements across passes
// (first placement wins), then drive the residue to ZERO with up to 3 forced re-passes over
// only the still-missing markers. Each caller supplies `callModel` — its own Anthropic-calling
// glue (Node SDK vs Workers-bound key) — built from the shared SYSTEM_PROMPT/GROUPS_SCHEMA/
// contextBlock above. Returns the final reconciled groups (including the trailing
// UNCATEGORIZED bucket for any residue the reconcile safety-net still catches).
export async function runMarkerGroupingPasses(
  client: Client,
  systems: string[],
  callModel: CallModel,
): Promise<{ group: string; markers: string[] }[]> {
  const markerNames = distinctMarkerNames(client);
  const place = new Map<string, string>();
  const absorb = (subset: string[], groups: { group: string; markers: string[] }[]): void => {
    for (const g of reconcileGroups(subset, systems, groups)) {
      if (g.group === UNCATEGORIZED) continue;
      for (const n of g.markers) if (!place.has(n)) place.set(n, g.group);
    }
  };

  absorb(markerNames, await callModel(markerNames, false));
  for (let round = 0; round < 3; round++) {
    const missing = markerNames.filter((n) => !place.has(n));
    if (missing.length === 0) break;
    const before = place.size;
    absorb(missing, await callModel(missing, true));
    if (place.size === before) break;
  }

  const raw = systems.map((s) => ({ group: s, markers: markerNames.filter((n) => place.get(n) === s) }));
  return reconcileGroups(markerNames, systems, raw);
}
