// The PURE ingest core: fold + parse + provenance, with no Node/fs/process
// dependency, so both a CLI and a browser/serverless ingest path reuse the exact same logic. The
// non-pure edges stay outside, in host-side modules:
//   - reading bytes / copying files / writing artifacts  → a host CLI (node:fs)
//   - content hashing (hashSource)                        → a host module (node:crypto;
//                                                            a browser supplies SubtleCrypto)
//   - the report LLM extraction (proposeFromReport)       → a host module (injected)
// This module takes BYTES + already-extracted data and mutates an in-memory Client.

import type { Client, SourceRecord } from "./types";

// The lab/dexa/scale byte parser (parseRawFile) lives in ./parse-raw so this module
// stays parser-free — parseDexa pulls in pdfjs-dist, which a browser fold path must not bundle.

// ── Content hash, WebCrypto twin of the Node hash a server-side caller uses. Same sha256 hex +
// 12-char id, so a Node import and a browser upload dedup identically. ──
export async function hashSourceWeb(bytes: Uint8Array): Promise<{ sha256: string; id: string }> {
  const buf =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
  const digest = new Uint8Array(await (globalThis.crypto as Crypto).subtle.digest("SHA-256", buf));
  let sha256 = "";
  for (const b of digest) sha256 += b.toString(16).padStart(2, "0");
  return { sha256, id: sha256.slice(0, 12) };
}

// ── Fold: merge parsed rows / a report extraction into an in-memory Client. Pure. ──
export { applySourceReadings, applyReportContribution, pruneOrphanImagingMarkers } from "./report-merge";

// ── Removal: cascade-delete one source + its derived data, with corroboration + a tombstone.
// The provenance check (provenanceIssues) backs vault:verify. Pure. ──
export { removeSource, provenanceIssues, processedSha8 } from "./report-merge";
export type { RemoveResult, ProvenanceIssue } from "./report-merge";

// ── Provenance: stored-name formatting + the SourceRecord registry. Pure. ──

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-05-19" → "2026May19"
export function formatDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  if (!m) return d.trim().replace(/[^a-zA-Z0-9]+/g, "") || "undated";
  return `${m[1]}${MONTHS[+m[2] - 1]}${m[3]}`;
}

// One date → "2026May19"; a span → "2025Sep02-2026May19".
export function dateSegment(dates: string[]): string {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (valid.length === 0) return "undated";
  const lo = formatDate(valid[0]);
  const hi = formatDate(valid[valid.length - 1]);
  return lo === hi ? lo : `${lo}-${hi}`;
}

const TYPE_BY_KIND: Record<SourceRecord["kind"], string> = {
  lab: "blood", dexa: "dexa", scale: "scale", imaging: "imaging",
};
export function typeForKind(kind: SourceRecord["kind"]): string {
  return TYPE_BY_KIND[kind];
}

// Words that describe the modality, not the region — dropped so the subtype is
// the body region (the user's example: "Renal Ultrasound" → "renal").
const MODALITY_WORDS = new Set([
  "ultrasound", "us", "ct", "cta", "mri", "mr", "scan", "xray", "x", "ray",
  "angiogram", "angiography", "limited", "with", "without", "wo", "w", "contrast", "and", "the", "of",
]);
const STUDY_SLUG_OVERRIDES: Record<string, string> = {
  "transthoracic echocardiogram": "echo",
  "echocardiogram": "echo",
};
export function slugStudyType(studyType: string): string {
  const norm = studyType.toLowerCase().trim();
  if (STUDY_SLUG_OVERRIDES[norm]) return STUDY_SLUG_OVERRIDES[norm];
  const words = norm.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  return words.find((w) => !MODALITY_WORDS.has(w)) ?? words[0] ?? "study";
}

export function subtypeFor(kind: SourceRecord["kind"], studyType?: string): string {
  if (kind === "imaging") return studyType ? slugStudyType(studyType) : "study";
  return kind === "lab" ? "panel" : kind === "dexa" ? "bodycomp" : "inbody";
}

// <dateSeg>-<type>-<subtype>-<sha8>.<ext>, e.g. 2021October15-imaging-coronary-13da11c4.pdf
export function storedName(opts: {
  sha256: string;
  kind: SourceRecord["kind"];
  subtype: string;
  dates: string[];
  ext: string;
}): string {
  const subtype = opts.subtype.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "x";
  return `${dateSegment(opts.dates)}-${typeForKind(opts.kind)}-${subtype}-${opts.sha256.slice(0, 8)}${opts.ext}`;
}

export function findSourceBySha(client: Client, sha256: string): SourceRecord | undefined {
  return client.sources?.find((s) => s.sha256 === sha256);
}

export function upsertSourceRecord(client: Client, rec: SourceRecord): void {
  client.sources ??= [];
  const i = client.sources.findIndex((s) => s.id === rec.id);
  if (i >= 0) client.sources[i] = rec;
  else client.sources.push(rec);
  // Re-ingesting a previously-removed sha clears its tombstone: the source is
  // live again, so leaving the tombstone would be a tombstone/live provenance collision.
  if (client.removedSources?.length) {
    client.removedSources = client.removedSources.filter((t) => t.sourceId !== rec.id);
    if (client.removedSources.length === 0) delete client.removedSources;
  }
}
