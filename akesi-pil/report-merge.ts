import type { Client, DiseaseEntry, MarkerResult, SourceRecord } from "./types";
import { addDisease, removeDiseasesBySourceId } from "./factors-edit";

export interface ProposedDisease {
  date: string;
  diagnostic: string;
  summary?: string;
  icdCodes?: string[];
}

function normDate(s: string): string {
  return s.trim().toLowerCase().replace(/[/.]/g, "-").replace(/\s+/g, " ");
}

function normDiag(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.;,]+$/, "");
}

export function diseaseKey(d: ProposedDisease): string {
  return `${normDate(d.date)}|${normDiag(d.diagnostic)}`;
}

function diagTokens(s: string): string[] {
  return normDiag(s).split(" ").filter(Boolean);
}

// A coarse coded comorbidity (e.g. "Bicuspid aortic valve" [Q23.81]) is covered
// by a more-detailed finding on the same date when every token of its label
// appears in the finding's diagnostic ("Bicuspid aortic valve with mild
// stenosis; AVA …"). Same-date + strict-superset keeps it conservative: it only
// ever folds a short label into a longer one, never merges two findings.
function findSubsumingDisease(diseases: DiseaseEntry[], d: ProposedDisease): DiseaseEntry | undefined {
  const dDate = normDate(d.date);
  const labelTokens = diagTokens(d.diagnostic);
  if (labelTokens.length === 0) return undefined;
  return diseases.find((h) => {
    if (normDate(h.date) !== dDate) return false;
    const hostTokens = diagTokens(h.diagnostic);
    if (hostTokens.length <= labelTokens.length) return false;
    const hostSet = new Set(hostTokens);
    return labelTokens.every((t) => hostSet.has(t));
  });
}

function mergeCodes(existing: string[] | undefined, incoming: string[]): string[] {
  const out = [...(existing ?? [])];
  for (const c of incoming) {
    const v = c.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export interface ApplyResult {
  diseasesAdded: number;
  diseasesAdopted: number;
  comorbiditiesMerged: number;
  markersAdded: number;
  markersAdopted: number;
}

// Apply ONE source's extracted contribution, scoped by its sourceId. Idempotent:
// re-running replaces only this source's entries, never touching hand-entered
// diagnoses or other sources' entries. A provenance-less entry that matches an
// extracted one is *adopted* (stamped with this sourceId) rather than duplicated.
//
// `markers` must already carry source "Imaging" and sourceId === sourceId.
export function applyReportContribution(
  client: Client,
  sourceId: string,
  diseases: ProposedDisease[],
  markers: MarkerResult[],
): ApplyResult {
  client.factors ??= {};
  client.factors.diseases ??= [];

  // 1. Drop this source's prior contribution so a re-run can't accumulate.
  removeDiseasesBySourceId(client, sourceId);
  client.results = client.results.filter(
    (r) => !(r.source === "Imaging" && r.sourceId === sourceId),
  );

  // 2. Diseases — within-source dedup; a code-bearing comorbidity already
  // covered by a more-detailed finding folds its code(s) into that row; else
  // adopt a provenance-less match; else add. Findings are listed before
  // comorbidities by the caller, so a comorbidity sees this source's findings.
  let diseasesAdded = 0;
  let diseasesAdopted = 0;
  let comorbiditiesMerged = 0;
  const seenD = new Set<string>();
  for (const d of diseases) {
    const k = diseaseKey(d);
    if (seenD.has(k)) continue;
    seenD.add(k);

    if (d.icdCodes?.length) {
      const host = findSubsumingDisease(client.factors.diseases, d);
      if (host) {
        host.icdCodes = mergeCodes(host.icdCodes, d.icdCodes);
        comorbiditiesMerged++;
        continue;
      }
    }

    const match = client.factors.diseases.find((x) => diseaseKey(x) === k && !x.sourceId);
    if (match) {
      match.sourceId = sourceId;
      if (d.summary) match.summary = d.summary;
      if (d.icdCodes?.length) match.icdCodes = mergeCodes(match.icdCodes, d.icdCodes);
      diseasesAdopted++;
    } else {
      addDisease(client, { date: d.date, diagnostic: d.diagnostic, summary: d.summary, sourceId, icdCodes: d.icdCodes });
      diseasesAdded++;
    }
  }

  // 3. Markers — adopt a provenance-less Imaging row by marker|date, else add.
  // A `fromComparison` row (a prior value backfilled from this report's narrative)
  // is a low-priority placeholder: it yields to any existing row, and a real
  // reading replaces it (see precedence rules below).
  let markersAdded = 0;
  let markersAdopted = 0;
  const seenM = new Set<string>();
  for (const m of markers) {
    const k = `${m.marker}|${m.date}`;
    if (seenM.has(k)) continue;
    seenM.add(k);
    const idx = client.results.findIndex((r) => r.marker === m.marker && r.date === m.date);
    const existing = idx >= 0 ? client.results[idx] : undefined;

    if (m.fromComparison) {
      // Rule 1: a placeholder is added only when nothing occupies this marker|date.
      if (!existing) { client.results.push(m); markersAdded++; }
      continue;
    }
    if (existing) {
      if (existing.fromComparison) {
        // Rule 2: a real reading ousts the placeholder.
        client.results[idx] = m;
        markersAdded++;
      } else if (existing.source === "Imaging" && !existing.sourceId) {
        existing.sourceId = sourceId;
        markersAdopted++;
      }
    } else {
      client.results.push(m);
      markersAdded++;
    }
  }
  client.results.sort((a, b) =>
    a.marker === b.marker ? a.date.localeCompare(b.date) : a.marker.localeCompare(b.marker),
  );

  return { diseasesAdded, diseasesAdopted, comorbiditiesMerged, markersAdded, markersAdopted };
}

// Merge readings parsed from a positional source file (lab/DEXA/scale), tagging
// provenance like imaging does: a parsed row that matches an existing
// provenance-less reading by marker|date *adopts* it (stamps this sourceId); a
// genuinely new reading is added with the sourceId; an already-sourced match is
// left alone (the first file to introduce a reading owns it). Idempotent.
export function applySourceReadings(
  client: Client,
  sourceId: string,
  rows: MarkerResult[],
  // On a --force re-ingest the file is authoritative for the (marker,date)s it
  // carries, so refresh the stored value/unit/ref/valueText (e.g. a parser fix
  // that re-reads a titer correctly). Provenance (sourceId) is left as-is.
  refresh = false,
): { added: number; adopted: number; updated: number } {
  let added = 0;
  let adopted = 0;
  let updated = 0;
  for (const row of rows) {
    const idx = client.results.findIndex((r) => r.marker === row.marker && r.date === row.date);
    const existing = idx >= 0 ? client.results[idx] : undefined;
    if (existing?.fromComparison) {
      // A directly-measured reading replaces a backfilled placeholder.
      client.results[idx] = { ...row, sourceId };
      added++;
    } else if (existing) {
      if (!existing.sourceId) { existing.sourceId = sourceId; adopted++; }
      if (refresh && (existing.value !== row.value || existing.unit !== row.unit || existing.valueText !== row.valueText)) {
        existing.value = row.value;
        existing.unit = row.unit;
        existing.ref = row.ref;
        if (row.valueText !== undefined) existing.valueText = row.valueText;
        else delete existing.valueText;
        updated++;
      }
    } else {
      client.results.push({ ...row, sourceId });
      added++;
    }
  }
  client.results.sort((a, b) =>
    a.marker === b.marker ? a.date.localeCompare(b.date) : a.marker.localeCompare(b.marker),
  );
  return { added, adopted, updated };
}

// An imaging marker is an orphan if it has no sourceId, or its sourceId no longer
// points to a live source record. Prune them so re-extraction drift can never
// leave stale duplicate series behind.
export function pruneOrphanImagingMarkers(client: Client): number {
  const live = new Set((client.sources ?? []).map((s) => s.id));
  const before = client.results.length;
  client.results = client.results.filter(
    (r) => !(r.source === "Imaging" && (!r.sourceId || !live.has(r.sourceId))),
  );
  return before - client.results.length;
}

export interface RemoveResult {
  removed: boolean;            // false when the source isn't on file (no-op)
  sourceId: string;
  sha8: string;
  kind: string;
  markersDropped: number;      // readings whose sole attribution was this source
  diseasesDropped: number;
  markersReattributed: number; // dropped readings re-added because a surviving source also supplies them
}

// Remove ONE source and everything it produced — the all-kinds generalization of
// pruneOrphanImagingMarkers. Drops the SourceRecord and every datum tagged with its
// sourceId (results incl. fromComparison placeholders; diseases incl. comorbidity codes
// folded into them), then re-applies the surviving sources' readings so a reading that a
// surviving source *also* measured is kept (corroboration — the W1b "a real reading wins"
// rule, re-attributed to a survivor). Appends a PHI-free tombstone. Idempotent: removing an
// absent source is a no-op and a tombstone is never duplicated. Pure — the CLI and a future
// web delete share it; file/R2 deletion is the caller's job.
export function removeSource(
  client: Client,
  sourceId: string,
  // Per surviving source: the readings it independently supplies (its pre-fold processed
  // rows). Used only to re-attribute a corroborated reading the removed source had owned.
  surviving: { sourceId: string; rows: MarkerResult[] }[] = [],
  removedAt = "",
): RemoveResult {
  const rec = client.sources?.find((s) => s.id === sourceId);
  if (!rec) {
    return { removed: false, sourceId, sha8: "", kind: "", markersDropped: 0, diseasesDropped: 0, markersReattributed: 0 };
  }
  const sha8 = rec.sha256.slice(0, 8);
  const kind = rec.kind;

  // 1. Drop the SourceRecord.
  client.sources = (client.sources ?? []).filter((s) => s.id !== sourceId);

  // 2. Drop derived data tagged with this sourceId.
  const resultsBefore = client.results.length;
  client.results = client.results.filter((r) => r.sourceId !== sourceId);
  const markersDropped = resultsBefore - client.results.length;

  const diseasesBefore = client.factors?.diseases?.length ?? 0;
  // Capture the ids BEFORE the rows go, so the finding's read of them can be pruned too.
  const removedDiseaseIds = new Set(
    (client.factors?.diseases ?? []).filter((d) => d.sourceId === sourceId).map((d) => d.id),
  );
  removeDiseasesBySourceId(client, sourceId);
  const diseasesDropped = diseasesBefore - (client.factors?.diseases?.length ?? 0);

  // 2b. And take the AI's turn ABOUT those diagnoses with them.
  //
  // A host-side `removeFrom` cascade closes this orphan class for notes, allergies, family
  // history and treatments, but report deletion never goes through that function — it comes
  // here — so `diseaseResults` was the one id-keyed section nothing ever pruned. The entries
  // stayed keyed to ids that no longer existed: invisible in the UI, travelling in the client
  // record, and reappearing if an id were reused. finding-invariants.ts flags exactly this as
  // "matches no row on file"; until now it was reporting a state no code could reach.
  if (removedDiseaseIds.size > 0 && client.finding?.diseaseResults) {
    client.finding.diseaseResults = client.finding.diseaseResults.filter((r) => !removedDiseaseIds.has(r.diseaseId));
  }

  // 3. Corroboration: re-apply each surviving source's readings. A reading the removed
  //    source had owned but a survivor also measured was dropped in step 2; re-applying
  //    re-adds it, now attributed to that survivor. Readings that still exist are adopted
  //    (no-op) or left alone, so this never duplicates.
  let markersReattributed = 0;
  for (const s of surviving) {
    if (s.sourceId === sourceId) continue;
    markersReattributed += applySourceReadings(client, s.sourceId, s.rows).added;
  }

  // 4. PHI-free tombstone (deduped by sourceId).
  client.removedSources ??= [];
  if (!client.removedSources.some((t) => t.sourceId === sourceId)) {
    client.removedSources.push({ sourceId, sha8, kind, removedAt });
  }

  return { removed: true, sourceId, sha8, kind, markersDropped, diseasesDropped, markersReattributed };
}

export interface SourceEditPatch {
  studyType?: string;             // imaging only
  dateKey: "studyDate" | "dateEnd" | "dateStart";
  date: string;
}

// M66 P3 — patch ONE source and its linked DiseaseEntry rows (by position, in sourceId order) in
// one mutation, keyed by sourceId — the patch counterpart to removeSource's drop. `diseasePatches`
// must line up 1:1 with diseasesForSource(sourceId)'s current order; a short/mismatched array is
// ignored past its own length (no add/remove of diagnoses here). Raw values in — normalizeClientDraft
// (factors-edit.ts) is still the caller's job for trimming/capFirst/date normalization.
export function updateSource(
  client: Client,
  sourceId: string,
  patch: SourceEditPatch,
  diseasePatches: { diagnostic: string; date: string; summary?: string; icdCodes?: string[] }[],
): void {
  const rec = client.sources?.find((s) => s.id === sourceId);
  if (rec) {
    if (patch.studyType !== undefined) rec.studyType = patch.studyType;
    rec[patch.dateKey] = patch.date;
  }
  const diseases = (client.factors?.diseases ?? []).filter((d) => d.sourceId === sourceId);
  diseases.forEach((d, i) => {
    const p = diseasePatches[i];
    if (!p) return;
    d.diagnostic = p.diagnostic;
    d.date = p.date;
    d.summary = p.summary;
    d.icdCodes = p.icdCodes;
  });
}

export interface ProvenanceIssue {
  kind: "dangling-result" | "dangling-disease" | "tombstone-live" | "treatment-missing-raw-capture";
  detail: string;
}

// The provenance invariant: no derived datum may carry a sourceId that no live
// SourceRecord answers for, and a tombstoned source must not also be live. (A
// provenance-LESS datum — hand-entered, no sourceId — is allowed.) A host's verify step runs
// this so a bad delete can't pass its pre-push gate.
export function provenanceIssues(client: Client): ProvenanceIssue[] {
  const live = new Set((client.sources ?? []).map((s) => s.id));
  const issues: ProvenanceIssue[] = [];
  for (const r of client.results) {
    if (r.sourceId && !live.has(r.sourceId)) {
      issues.push({ kind: "dangling-result", detail: `${r.marker}|${r.date} → missing source ${r.sourceId}` });
    }
  }
  for (const d of client.factors?.diseases ?? []) {
    if (d.sourceId && !live.has(d.sourceId)) {
      issues.push({ kind: "dangling-disease", detail: `${d.date}|${d.diagnostic} → missing source ${d.sourceId}` });
    }
  }
  for (const t of client.removedSources ?? []) {
    if (live.has(t.sourceId)) {
      issues.push({ kind: "tombstone-live", detail: `tombstone ${t.sourceId} (${t.sha8}) is also a live source` });
    }
  }
  // A treatment that claims to have been read off a photo or pasted text (extracted) must still
  // have that raw capture on file — otherwise "extracted" is an unverifiable claim, not provenance.
  for (const t of client.factors?.treatments ?? []) {
    if (t.extracted?.via === "photo" && !t.attachments?.some((a) => t.rawCaptureAttachmentKeys?.includes(a.key))) {
      issues.push({ kind: "treatment-missing-raw-capture", detail: `${t.name} (${t.id}) → extracted via photo, no raw capture attachment on file` });
    }
    if (t.extracted?.via === "text" && !t.rawCaptureText?.trim()) {
      issues.push({ kind: "treatment-missing-raw-capture", detail: `${t.name} (${t.id}) → extracted via text, no rawCaptureText on file` });
    }
  }
  return issues;
}

// A SourceRecord references its raw bytes (rec.file) and a processed artifact (by sha8).
// Existence of those files is a caller's check, Node-side — this module stays fs-free — but the
// expected processed sha8 is derived here for a single source.
export function processedSha8(rec: SourceRecord): string {
  return rec.sha256.slice(0, 8);
}
