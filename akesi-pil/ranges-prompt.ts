// The Node/process-free edge of Ranges generation, mirroring report-extract.ts's split: the
// schema, prompt and validation live here, so a Node caller (which brings its own env-keyed
// client) and an edge-runtime caller (which injects one) run the exact same logic.
//
// This module must never import the Finding inference graph. That is the whole point: a host
// serving only Ranges can then keep that graph out of its bundle entirely.
import { ageYears } from "./ranges";
import type { Client, ClientFactors, MarkerResult } from "./types";
import { treatmentsOf } from "./treatment-normalize";
import { bucketOf, todayISODate } from "./treatment-bucket";

export const RANGE_SCHEMA = {
  type: "object",
  properties: {
    low: { type: ["number", "null"] },
    high: { type: ["number", "null"] },
    unit: { type: "string" },
    meaning: { type: "string" },
    explanation: { type: "string" },
    explanationImperial: { type: ["string", "null"] },
    generalLow: { type: ["number", "null"] },
    generalHigh: { type: ["number", "null"] },
    generalExplanation: { type: "string" },
  },
  required: ["low", "high", "unit", "meaning", "explanation", "explanationImperial", "generalLow", "generalHigh", "generalExplanation"],
  additionalProperties: false,
} as const;

export interface RangeAIResponse {
  low: number | null;
  high: number | null;
  unit: string;
  meaning: string;
  explanation: string;
  explanationImperial: string | null;
  generalLow: number | null;
  generalHigh: number | null;
  generalExplanation: string;
}

export const IMPERIAL_CONVERTS: Record<string, string> = {
  kg: "lb",
  g: "lb",
  cm: "in",
  "cm²": "in²",
  "cm³": "in³",
  "g/L": "mg/dL",
};

function describeFactors(client: Client): string {
  const age = ageYears(client.dob);
  const parts: string[] = [];
  parts.push(`${age ?? "unknown age"}-year-old ${client.gender}`);
  const f: ClientFactors = client.factors ?? {};
  if (f.diseases && f.diseases.length > 0) {
    const fmt = f.diseases.map((d) => `${d.diagnostic} (${d.date})`).join(", ");
    parts.push(`prior diagnoses: ${fmt}`);
  }
  const today = todayISODate();
  const ongoing = treatmentsOf(client).filter((t) => bucketOf(t, today) === "ongoing");
  if (ongoing.length > 0) {
    const fmt = ongoing
      .map((t) => `${[t.name, t.dose].filter(Boolean).join(" ")}${t.start ? ` [${t.start}]` : ""}`.trim())
      .join(", ");
    parts.push(`current treatments: ${fmt}`);
  }
  if (f.pregnancy && f.pregnancy !== "none") parts.push(f.pregnancy);
  if (f.athletic) parts.push(`${f.athletic} activity level`);
  if (f.height) parts.push(`height ${f.height}`);
  if (typeof f.bmi === "number") parts.push(`BMI ${f.bmi}`);
  if (f.smoking) parts.push(`${f.smoking} smoker`);
  if (f.ethnicity) parts.push(`ethnicity: ${f.ethnicity}`);
  if (f.goal) parts.push(`personal health goal: ${f.goal}`);
  if (f.focus) parts.push(`current clinical focus: ${f.focus}`);
  return parts.join("; ");
}

export function systemPromptFor(client: Client): string {
  return [
    "You are advising on optimal/functional reference ranges for blood and body markers,",
    "personalized to one specific patient. You will be given a marker name and the unit",
    "in which results are reported. Reply with strict JSON matching the requested schema.",
    "",
    "Guidance:",
    "- Use peer-reviewed medical literature. Prefer functional/optimal ranges over the broad",
    "  lab 'normal' range when they meaningfully differ.",
    "- The 'unit' field in your response MUST match the unit provided in the user message,",
    "  with values scaled accordingly. Do not change units.",
    "- When the same unit string appears across multiple assays with very different",
    "  reference ranges (notably Free testosterone in pg/mL, Insulin, IGF-1 across",
    "  ages, some hormones), use the patient's recent measured values shown in the",
    "  user message to decide which assay produced them, and target a reference range",
    "  from that same assay. The chosen low/high MUST be on the same scale as those",
    "  measured values. If the patient's measurements lie entirely above or entirely",
    "  below the range you're considering, you have picked the wrong assay scale.",
    "- low and high are numbers in that unit, or null if the marker has only an upper or",
    "  lower bound (e.g. 'less than 5 mg/L'). At least one of low/high must be a number.",
    "- meaning is a short, patient-INDEPENDENT definition of what the marker is and what it",
    "  reflects physiologically — one plain phrase, ~8-18 words, no numbers or ranges. It",
    "  answers 'what is this marker?' for a layperson (e.g. \"ApoB counts the atherogenic",
    "  particles that drive plaque; the core lipid causal to heart disease\"). Do NOT discuss",
    "  this patient, their factors, or their target here — that is the explanation's job.",
    "- explanation is the DISCUSSION of why the PERSONALIZED range is more relevant for",
    "  THIS patient than the general range — 2-4 plain sentences (target 400-700",
    "  characters, hard cap 900). Name the specific factors below that shift the",
    "  personalized range and why they matter for this person. You MAY refer to \"the",
    "  general range\" by name when you contrast, but do NOT re-quote its numbers — they",
    "  are already shown on the separate 'General range' line, so e.g. \"tighter than the",
    "  general range\" suffices. If no factor meaningfully shifts the range from the",
    "  general one, say so plainly.",
    "- generalLow / generalHigh: the GENERAL reference range for this marker based ONLY on",
    "  the patient's age, gender, and height. EXPLICITLY IGNORE this patient's conditions,",
    "  prior diagnoses, medications, supplements, stated goal, and clinical focus for these",
    "  two fields — those shape ONLY the personalized low/high above. Same unit and scale as",
    "  low/high (null where a side is unbounded; at least one must be a number). Use a",
    "  standard population/clinical-guideline range, or a simple guideline formula where one",
    "  is conventional (e.g. waist circumference target < half of height). This is the",
    "  baseline a typical same-age, same-sex, same-height person would be measured against.",
    "- generalExplanation: 1-2 plain sentences stating the general range and its age/gender/",
    "  height basis (the guideline or population reference). Do NOT mention this patient's",
    "  conditions, medications, supplements, or goals here.",
    "- explanationImperial: if the lab unit is one of kg, g, cm, cm², cm³, g/L (i.e. has",
    "  an American/imperial equivalent: lb, in, in², in³, mg/dL), provide the same 2-4",
    "  sentence explanation but with every numeric mention converted to the imperial",
    "  unit (and any reference-range parenthetical also in imperial). Otherwise (e.g.",
    "  units like mg/dL, ng/mL, mmol/L, %, IU/L that don't convert), return null —",
    "  the metric explanation will be reused for both unit systems.",
    "- If the patient states a personal health goal (e.g. Health span, Longevity,",
    "  Performance, Fertility, Weight loss), weight the range toward that goal: prefer",
    "  tighter optimal ranges that maximize the stated outcome, and call out in the",
    "  explanation how the goal influenced the bounds.",
    "- If the patient states a current clinical focus (e.g. lower visceral fat,",
    "  lower LDL/ApoB, raise HDL, improve insulin sensitivity), treat it as a more",
    "  specific aim on top of the broader goal: tighten the range for markers",
    "  directly relevant to that focus, and name the focus in the explanation when",
    "  it shifts the bound. For markers unrelated to the focus, defer to the goal.",
    "- Medications and supplements do NOT shift the personalized range. The range",
    "  is the patient's goal-aligned target (e.g. healthspan-optimized ApoB), and",
    "  is the same whether or not they take any medication or supplement. Do not",
    "  'predict' the patient's level after treatment by tightening or loosening",
    "  the range. The range is set by age, gender, conditions, goal, and the other",
    "  factors below — never by what the patient is currently taking.",
    "- However, the explanation should describe what level may be anticipated as",
    "  a result of any relevant current medication or supplement, so the patient",
    "  can judge whether their regimen is moving them toward the goal range. For",
    "  example: 'tirzepatide can be expected to bring HbA1c toward ~5%';",
    "  'ezetimibe typically lowers ApoB by ~20-25% from baseline'; 'glycine 3-15g",
    "  can lower HbA1c by ~0.2-0.5 points and improve sleep-driven glucose control'.",
    "  Be specific about anticipated direction and magnitude when relevant.",
    "",
    `Patient: ${describeFactors(client)}.`,
  ].join("\n");
}

/** The unit a marker is measured in: the LATEST reading's, by date. `""` for a dimensionless ratio.
 *  Whether a `""` here means "dimensionless" or "never ingested" is the host's call, not this
 *  module's — see the caller's NoMeasuredUnitError. */
export function unitForMarker(client: Client, marker: string): { unit: string; rows: MarkerResult[] } {
  const rows = client.results
    .filter((r) => r.marker === marker)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { unit: rows.length > 0 ? rows[rows.length - 1].unit : "", rows };
}

/** The prompt's unit line — spelled out for a dimensionless ratio marker (unit "") so the model
 *  can't read it as missing data. Named and exported so the benchmark's "after" arm scores this
 *  exact shipped text rather than a hand-copied snapshot that could drift from it. */
export function unitLineFor(unit: string): string {
  return unit
    ? `Unit: ${unit}`
    : `Unit: (dimensionless ratio — this marker has no physical unit; return "" for the unit field)`;
}

/** The Ranges user message, the other half of the prompt `systemPromptFor` starts. Lives here for
 *  the same reason the system prompt does: the CLI and the Function must never word it two
 *  different ways, and a golden fixture can only cover text this package owns. */
export function rangesUserMessage(client: Client, marker: string): string {
  const { unit, rows } = unitForMarker(client, marker);
  const recent = rows.slice(-5);
  const measuredLine =
    recent.length > 0
      ? `Recent measured values for this patient (use these to disambiguate assay/unit scale when the same unit appears across assays with different reference ranges): ${recent.map((r) => `${r.date}: ${r.value}`).join(", ")}`
      : `Recent measured values for this patient: (none on file)`;
  const imperialUnit = IMPERIAL_CONVERTS[unit];
  const imperialReminder = imperialUnit
    ? `\nThis unit (${unit}) has an imperial equivalent (${imperialUnit}); explanationImperial is REQUIRED, not null — at least 20 chars converting every number to ${imperialUnit}.`
    : "";
  return `Marker: ${marker}\n${unitLineFor(unit)}${imperialReminder}\n${measuredLine}\n\nReturn the personalized reference range as JSON.`;
}

export function validate(marker: string, expectedUnit: string, r: RangeAIResponse): void {
  if (r.low == null && r.high == null) {
    throw new Error(`range for "${marker}" has neither low nor high`);
  }
  if (r.low != null && r.high != null && r.low >= r.high) {
    throw new Error(`range for "${marker}" has low (${r.low}) >= high (${r.high})`);
  }
  if (expectedUnit !== "" && (!r.unit || r.unit.trim() === "")) {
    throw new Error(`range for "${marker}" missing unit`);
  }
  if (normalizeUnit(r.unit) !== normalizeUnit(expectedUnit)) {
    throw new Error(
      `range for "${marker}" returned unit "${r.unit}" but lab data is in "${expectedUnit}"`,
    );
  }
  if (!r.meaning || r.meaning.trim().length === 0) {
    throw new Error(`range for "${marker}" missing meaning`);
  }
  if (!r.explanation || r.explanation.trim().length === 0) {
    throw new Error(`range for "${marker}" missing explanation`);
  }
  if (IMPERIAL_CONVERTS[expectedUnit] && (!r.explanationImperial || r.explanationImperial.trim().length === 0)) {
    throw new Error(`range for "${marker}" (unit ${expectedUnit}) missing imperial explanation`);
  }
  if (r.generalLow == null && r.generalHigh == null) {
    throw new Error(`range for "${marker}" has neither generalLow nor generalHigh`);
  }
  if (r.generalLow != null && r.generalHigh != null && r.generalLow >= r.generalHigh) {
    throw new Error(`range for "${marker}" has generalLow (${r.generalLow}) >= generalHigh (${r.generalHigh})`);
  }
  if (!r.generalExplanation || r.generalExplanation.trim().length === 0) {
    throw new Error(`range for "${marker}" missing generalExplanation`);
  }
}

function normalizeUnit(u: string): string {
  return u.toLowerCase().replace(/\s+/g, "").replace(/μ/g, "u");
}
