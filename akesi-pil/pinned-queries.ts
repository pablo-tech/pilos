// Every pinned item in one client, as AREAS OF QUERY.
//
// This is the single place that answers "what has the user starred?", and it exists because that
// answer is needed in three places that must not be allowed to disagree: the clinical prompt
// (finding-generate.ts), the staleness hash (factors-hash.ts), and the UI notice that tells the
// user their pins will steer the next Finding.
//
// WHAT A PIN MEANS — this is the load-bearing distinction in this file:
//
//   A pin says WHAT TO LOOK INTO. It never says what is true.
//
// A pinned question is not an answered question. A pinned glossary term is not a diagnosis. A
// pinned report is not a summary of that report — the report's own extracted data reaches the model
// through the ordinary evidence sections, and pinning it adds nothing to that evidence, only
// emphasis on the topic. Nothing in this file is a clinical record, a finding, or a source of fact,
// and the prompt block built from it says so in as many words.
//
// The stakes are concrete: a patient pinning "Could this be early kidney disease?" must never
// cause the model to write as though early kidney disease were established. They asked a question.
import type { Client } from "./types";
import { reportTitleOf } from "./report-title";
import { pinnedItems } from "./item-registry";
import { SECTION_LABEL } from "./section-labels";

export interface PinnedQuery {
  /** The section it was pinned in, shown to the model as the area's context. */
  section: string;
  label: string;
}

const MAX_LABEL = 160;

function clip(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL) + "…" : t;
}

// A generated item's kind, as the section KEY it belongs to — the label itself comes from
// section-labels' SECTION_LABEL, so this file cannot spell a section differently from the app.
const GENERATED_SECTION_KEY: Record<string, string> = {
  question: "docInference",
  glossary: "definitions",
  exploration: "exploration",
  analysis: "analysis",
  recommendedMarkers: "healthMarkers",
};

/**
 * Every pinned item, in a stable section order.
 *
 * `client.watchlist` is deliberately NOT here. Watchlisted markers already reach the prompt as
 * their own section and are already in the staleness hash; folding them in too would double them
 * in the prompt and, worse, change the hash of every client who has ever watchlisted a marker —
 * a mass regeneration bought for nothing.
 */
export function pinnedQueries(client: Client): PinnedQuery[] {
  const f = client.factors ?? {};
  const out: PinnedQuery[] = [];
  const push = (section: string, label: string | undefined | null) => {
    const t = label?.trim();
    if (t) out.push({ section, label: clip(t) });
  };

  // M74 reversed, on the owner's instruction (2026-08-20): a ratio name used to be barred from the
  // prompt outright. As an area of query it is safe and useful — "look at the TG/HDL ratio" is a
  // topic, not a reading — and the block below is explicit that it is not data.
  for (const name of client.pinnedRatios ?? []) push("Marker ratios", name);
  const label = (key: string) => SECTION_LABEL[key] ?? key;
  for (const s of client.sources ?? []) if (s.pinned) push(label("clinicalReports"), reportTitleOf(s));
  for (const r of pinnedItems(client)) push(label(GENERATED_SECTION_KEY[r.kind] ?? r.kind), r.label);
  for (const n of f.noteEntries ?? []) if (n.pinned) push(label("notes"), n.text);
  for (const e of client.study?.entries ?? []) if (e.pinned) push(label("study"), e.focus);
  for (const t of f.treatments ?? []) if (t.pinned) push(label("treatment"), t.name);
  for (const d of f.decisions ?? []) if (d.pinned) push(label("futureTreatment"), d.intervention);
  for (const a of f.allergies ?? []) if (a.pinned) push(label("allergies"), a.allergen);
  for (const h of f.familyHistory ?? []) if (h.pinned) push(label("familyHistory"), h.relation);
  return out;
}

/** Canonical, sorted, de-duplicated — the form the staleness hash uses. */
export function pinnedQueryLines(client: Client): string[] {
  return [...new Set(pinnedQueries(client).map((q) => `${q.section}|${q.label}`))].sort();
}

/**
 * The prompt section, or null when nothing is pinned — the caller omits the section entirely rather
 * than sending "Areas of query: (none)", which would be a sentence about nothing.
 */
export function pinnedQueryBlock(client: Client): string | null {
  const items = pinnedQueries(client);
  if (items.length === 0) return null;
  const bySection = new Map<string, string[]>();
  for (const q of items) bySection.set(q.section, [...(bySection.get(q.section) ?? []), q.label]);
  const body = [...bySection]
    .map(([section, labels]) => `  ${section}:\n` + labels.map((l) => `    - ${l}`).join("\n"))
    .join("\n");
  return (
    `Areas of query (${items.length} item${items.length === 1 ? "" : "s"} the patient or their ` +
    `provider has STARRED, asking you to look into them).\n\n` +
    `READ THIS BEFORE USING THE LIST. These are questions, not answers:\n` +
    `  • They tell you WHAT TO LOOK INTO. They never tell you what is true.\n` +
    `  • They are NOT evidence, NOT clinical record, NOT data, and NOT a source you may cite. ` +
    `Every fact you state must still come from the evidence sections above — the markers, ` +
    `reports, treatments, study notes and profile.\n` +
    `  • A starred question is an OPEN question. Never write as though it were settled. A starred ` +
    `glossary term, report or topic means "this is on their mind", nothing more.\n` +
    `  • If the evidence does not support saying anything about a starred area, say that plainly ` +
    `rather than inventing a finding to fill it.\n` +
    `  • Where the evidence DOES speak to a starred area, give it more of your attention and more ` +
    `of your words than you otherwise would. That is the entire effect of a star.\n\n` +
    body
  );
}
