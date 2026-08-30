import type { Client, ClientFactors, DiseaseEntry, TreatmentItem } from "./types";
import { endOfMonth } from "./dates";

// Pure normalization shared by every editing surface a host offers — a CLI and a web editor
// alike — so a value entered either way is stored identically.

export function capFirst(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Disease mutations — pure, so the report-fold (report-merge.ts) and any browser or server-side
// ingest path can reuse them without depending on a Node CLI.
// Callers add a disease by content only — id is always minted here, pinned always starts false.
export function addDisease(client: Client, item: Omit<DiseaseEntry, "id" | "pinned">): void {
  client.factors ??= {};
  client.factors.diseases ??= [];
  const entry: DiseaseEntry = {
    id: crypto.randomUUID(),
    date: endOfMonth(item.date.trim()),
    diagnostic: capFirst(item.diagnostic),
  };
  if (item.summary) entry.summary = item.summary.trim();
  if (item.sourceId) entry.sourceId = item.sourceId;
  const codes = (item.icdCodes ?? []).map((c) => c.trim()).filter(Boolean);
  if (codes.length) entry.icdCodes = codes;
  client.factors.diseases.push(entry);
}

export function removeDiseasesBySourceId(client: Client, sourceId: string): void {
  if (!client.factors?.diseases) return;
  client.factors.diseases = client.factors.diseases.filter((d) => d.sourceId !== sourceId);
}

export function removeDisease(client: Client, diagnostic: string): void {
  if (!client.factors?.diseases) return;
  const v = capFirst(diagnostic);
  client.factors.diseases = client.factors.diseases.filter((d) => d.diagnostic !== v);
}

export function clearDiseases(client: Client): void {
  if (client.factors) client.factors.diseases = [];
}

export const PREGNANCY_VALUES = ["none", "pregnant", "postpartum", "menopause"] as const;
export const ATHLETIC_VALUES = ["sedentary", "moderate", "endurance"] as const;
export const SMOKING_VALUES = ["never", "former", "current"] as const;

function dedup(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

// Apply the same normalization the CLI add* verbs apply, then drop empty rows.
// Operates on a copy — does not mutate the input. Leaves results/finding/ranges
// and any non-authored fields untouched.
export function normalizeClientDraft(client: Client): Client {
  const f: ClientFactors = client.factors ? { ...client.factors } : {};

  if (f.diseases) {
    f.diseases = f.diseases
      .filter((d) => d.diagnostic.trim())
      .map((d) => {
        const entry = { ...d, date: endOfMonth(d.date.trim()), diagnostic: capFirst(d.diagnostic) };
        if (entry.summary != null) {
          const s = entry.summary.trim();
          if (s) entry.summary = s; else delete entry.summary;
        }
        const codes = (entry.icdCodes ?? []).map((c) => c.trim()).filter(Boolean);
        if (codes.length) entry.icdCodes = codes; else delete entry.icdCodes;
        return entry;
      });
  }
  if (f.treatments) {
    f.treatments = f.treatments
      .filter((t) => t.name.trim())
      .map((t) => {
        const entry: TreatmentItem = { ...t, name: capFirst(t.name), start: endOfMonth((t.start ?? "").trim()) };
        const dose = (t.dose ?? "").trim();
        if (dose) entry.dose = dose; else delete entry.dose;
        if (t.kind) entry.kind = t.kind;
        const end = (t.end ?? "").trim();
        if (end) entry.end = endOfMonth(end); else delete entry.end;
        return entry;
      });
  }
  if (f.allergies) {
    f.allergies = f.allergies
      .filter((a) => a.allergen.trim())
      .map((a) => {
        const entry = { ...a, allergen: capFirst(a.allergen), reaction: capFirst(a.reaction) };
        if (entry.dateNoted != null) {
          const d = entry.dateNoted.trim();
          if (d) entry.dateNoted = d; else delete entry.dateNoted;
        }
        return entry;
      });
  }
  if (f.familyHistory) {
    f.familyHistory = f.familyHistory
      .filter((h) => h.relation.trim() && h.condition.trim())
      .map((h) => ({ ...h, relation: capFirst(h.relation), condition: capFirst(h.condition) }));
  }
  if (f.decisions) {
    const out: ClientFactors["decisions"] = [];
    const byIntervention = new Map<string, number>();
    for (const d of f.decisions) {
      if (!d.intervention.trim()) continue;
      const entry = { ...d, intervention: capFirst(d.intervention), purpose: capFirst(d.purpose) };
      const at = byIntervention.get(entry.intervention);
      if (at != null) out![at] = entry;
      else { byIntervention.set(entry.intervention, out!.length); out!.push(entry); }
    }
    f.decisions = out;
  }
  if (f.noteEntries) {
    f.noteEntries = f.noteEntries.filter((n) => n.text.trim()).map((n) => ({ ...n, text: capFirst(n.text) }));
  }
  for (const key of ["ethnicity", "goal", "focus"] as const) {
    if (f[key] != null) {
      const v = capFirst(f[key]!);
      if (v) f[key] = v; else delete f[key];
    }
  }
  if (f.height != null) {
    const h = f.height.trim();
    if (h) f.height = h; else delete f.height;
  }
  // Drop emptied arrays back to absent, so saving with nothing entered
  // reproduces the original canonical form (no spurious hash change).
  for (const key of ["diseases", "treatments", "allergies", "familyHistory", "decisions", "noteEntries"] as const) {
    if (f[key] && f[key]!.length === 0) delete f[key];
  }

  let study = client.study ? { ...client.study } : undefined;
  if (study) {
    if (study.entries) {
      study.entries = study.entries
        .filter((e) => e.focus.trim())
        .map((e) => ({ ...e, focus: e.focus.trim(), detail: e.detail.trim() }));
      if (study.entries.length === 0) delete study.entries;
    }
    if (!study.entries) study = undefined;
  }

  const recommended = client.recommended
    ? dedup(client.recommended.map((w) => w.trim()).filter(Boolean))
    : client.recommended;
  return {
    ...client,
    factors: f,
    study,
    watchlist: dedup(client.watchlist.map((w) => w.trim()).filter(Boolean)),
    recommended: recommended && recommended.length === 0 ? undefined : recommended,
  };
}
