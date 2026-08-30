// The report LLM extraction, pure of Node/process/env so both a CLI and a
// serverless function call the exact same schema + prompt + validation. The Anthropic client is
// INJECTED (a CLI passes its env-keyed singleton; a function passes one built
// from its own env var), and the model is a required arg (no default), so
// this module never touches process.env or any host-side inference config.
import type Anthropic from "@anthropic-ai/sdk";
import { ageYears } from "./ranges";
import type { Client } from "./types";
import { CANONICAL_IMAGING_MARKERS } from "./imaging-catalog";
import { readDocumentAsJson, type DocumentSource, type UsageRecorder } from "./document-model";

// Only the fields systemPromptFor reads. The CLI passes a full Client; the Function
// passes a minimized {dob, gender, factors:{diseases}} so the whole vault never
// transits the server (the report itself does — a documented, bounded exposure).
// `diseases` is intentionally narrower than the real DiseaseEntry — only diagnostic/date are ever
// read here (for naming-consistency context), so callers don't need a real id/pinned to build one.
export interface ReportPatient {
  dob: Client["dob"];
  gender: Client["gender"];
  factors?: { diseases?: { diagnostic: string; date: string }[] };
}

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    // The import gate. Reports is the one surface that must refuse a non-report — Chat and Notes
    // accept any PDF for discussion, which is only safe because this keeps Reports from becoming a
    // dumping ground. Asked in the SAME call as the extraction, so the check is free.
    isMedicalReport: { type: "boolean" },
    notReportReason: { type: "string" },
    studyType: { type: "string" },
    diseases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          diagnostic: { type: "string" },
          summary: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["date", "diagnostic", "summary", "confidence"],
        additionalProperties: false,
      },
    },
    comorbidities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["code", "label", "description", "confidence"],
        additionalProperties: false,
      },
    },
    priorComparisons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          marker: { type: "string" },
          priorValue: { type: "number" },
          priorDate: { type: "string" },
          currentValue: { type: "number" },
          unit: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["marker", "priorValue", "priorDate", "currentValue", "unit", "confidence"],
        additionalProperties: false,
      },
    },
    markers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          marker: { type: "string" },
          value: { type: "number" },
          unit: { type: "string" },
          date: { type: "string" },
          group: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["marker", "value", "unit", "date", "group", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["isMedicalReport", "notReportReason", "studyType", "diseases", "comorbidities", "priorComparisons", "markers"],
  additionalProperties: false,
} as const;

// `summary` is optional here and required nowhere: validate() (below) rejects a FRESH
// extraction that lacks one, while a cached ImagingExtraction from the client record (types.ts, the
// mirror of this shape) has always declared it optional. Requiring it made the two shapes
// mutually unassignable, which a host ingest path hits on every re-import of a cached PDF.
export interface ProposedDiseaseEntry {
  date: string;
  diagnostic: string;
  summary?: string;
  confidence: number;
}

export interface ProposedComorbidity {
  code: string;
  label: string;
  // Optional so a cached extraction from before this field stays assignable.
  description?: string;
  confidence: number;
}

export interface ProposedMarkerEntry {
  marker: string;
  value: number;
  unit: string;
  date: string;
  group: string;
  confidence: number;
}

export interface ProposedPriorComparison {
  marker: string;
  priorValue: number;
  priorDate: string;
  currentValue: number;
  unit: string;
  confidence: number;
}

export interface ProposedReport {
  // Optional so a cached extraction from before the gate existed stays assignable — validate()
  // only rejects an EXPLICIT false, never an absent field.
  isMedicalReport?: boolean;
  notReportReason?: string;
  studyType: string;
  diseases: ProposedDiseaseEntry[];
  // Optional so a cached extraction (ImagingExtraction) from before these fields
  // existed stays assignable; fresh extractions always carry them (schema-required).
  comorbidities?: ProposedComorbidity[];
  priorComparisons?: ProposedPriorComparison[];
  markers: ProposedMarkerEntry[];
}

// Both moved to document-model.ts when the transport was generalized (a second reader,
// document-read.ts, needs the identical source union and usage hook). Re-exported under their
// original names so every existing importer of this module is unaffected.
export type { UsageRecorder, DocumentSource } from "./document-model";
export type ReportSource = DocumentSource;

function describeFactors(client: ReportPatient): string {
  const age = ageYears(client.dob);
  const parts: string[] = [`${age ?? "unknown age"}-year-old ${client.gender}`];
  const f = client.factors ?? {};
  if (f.diseases && f.diseases.length > 0) {
    parts.push(`existing on-file diagnoses (for naming consistency only): ${f.diseases.map((d) => `${d.diagnostic} (${d.date})`).join("; ")}`);
  }
  return parts.join("; ");
}

export function systemPromptFor(client: ReportPatient, today: string): string {
  return [
    "You read ONE narrative medical report (typically a radiology or imaging study,",
    "e.g. an Epic MyChart 'Test Details' report with HISTORY / TECHNIQUE / FINDINGS /",
    "IMPRESSION sections) and extract its clinical content as strict JSON matching the",
    "requested schema. The output drives a patient's Diagnosed Disease list and trended",
    "imaging markers, so be precise and conservative — never invent.",
    "",
    `Today is ${today}.`,
    "",
    "Extract:",
    "- isMedicalReport: FIRST decide whether this document is a clinical report about a patient",
    "  that states results — a lab panel, an imaging/radiology study, a pathology report, a",
    "  diagnostic test result. It is FALSE for a product label or package insert, a research paper,",
    "  a bill or explanation of benefits, an appointment or insurance letter, a consent form,",
    "  marketing material, or anything that does not report this patient's own measured results.",
    "  When it is false, say so in notReportReason in ONE sentence naming what the document is",
    "  instead, emit an empty string for studyType and empty arrays everywhere, and extract nothing",
    "  — do NOT try to salvage clinical-sounding content out of a document that is not a report.",
    "  When it is true, emit an empty string for notReportReason and extract as below.",
    "- studyType: a short label for the study, Title Case (e.g. 'Coronary CTA',",
    "  'Abdominal Ultrasound', 'Renal Ultrasound', 'Chest CT').",
    "- diseases: one entry per DISTINCT clinically meaningful finding or impression in",
    "  the report. Each:",
    "    • date: the date the EXAM WAS PERFORMED (study/collection date, not the order or",
    "      result-release date). Emit ISO YYYY-MM-DD when the report states an unambiguous",
    "      study date; if the date is ambiguous or absent, emit the report's own date text",
    "      verbatim rather than guessing.",
    "    • diagnostic: a TERSE one-line impression in the clinician's shorthand, matching",
    "      the house style of these examples: 'CAC: 34; CAD-RADS 1 in the Mid-LAD',",
    "      '1-24% Diffuse hepatic steatosis', 'Non Alcoholic Fatty Liver Disease'. Fold the",
    "      key quantitative result into the line where one exists. Prefer the report's",
    "      IMPRESSION wording. ONE entry per distinct clinical finding — combine a",
    "      quantitative result and its interpretation/category/grade into a SINGLE line",
    "      (a calcium score and its CAD-RADS grade are one entry, e.g. 'CAC: 34; CAD-RADS",
    "      1 in the Mid-LAD'). Do NOT emit a second entry that merely restates the same",
    "      finding with a percentile, risk phrase, or interpretation.",
    "    • summary: 1–3 complete sentences giving the clinically meaningful NATURE",
    "      and METRICS behind the terse diagnostic, drawn from the report's FINDINGS",
    "      and IMPRESSION — the detail a physician would want when reasoning about it.",
    "      Include the concrete numbers and descriptors: e.g. for coronary, the total",
    "      and per-vessel calcium score, the CAD-RADS grade, the stenosis %, plaque",
    "      type and location; for a valve, the bicuspid/tricuspid morphology, gradients,",
    "      regurgitation; for fatty liver, the steatosis grade/extent, echogenicity,",
    "      any fibrosis or accompanying findings. Be specific and factual to THIS",
    "      report; do not speculate beyond it or restate generic risk boilerplate.",
    "    • confidence: 0..1, how clearly the report states this finding.",
    "  Do NOT emit entries for normal/unremarkable structures or boilerplate. An entirely",
    "  normal report yields an empty diseases array.",
    "- comorbidities: the report header's CODED diagnosis list — the structured",
    "  encounter/visit Diagnosis section that pairs an ICD-10 code with a label",
    "  (e.g. 'I25.10 Atherosclerotic heart disease of native coronary artery without",
    "  angina', 'E78.5 Hyperlipidemia, unspecified'). These are the patient's standing",
    "  problem-list conditions, NOT findings of this study. Each:",
    "    • code: the ICD-10 code verbatim (e.g. 'I25.10').",
    "    • label: the condition name, concise (e.g. 'Coronary artery disease',",
    "      'Hyperlipidemia'). Prefer the common clinical name over the verbose ICD wording.",
    "    • description: the report's OWN full descriptor for this diagnosis, verbatim",
    "      but WITHOUT the bracketed code (e.g. 'Arteriosclerotic coronary artery",
    "      disease', 'Hyperlipidemia, unspecified hyperlipidemia type'). This is the",
    "      header text as written; do not paraphrase, expand, or add clinical detail the",
    "      header does not state. If the header gives only the bare label, repeat it.",
    "    • confidence: 0..1.",
    "  Only emit a comorbidity that appears as a coded header diagnosis. Do NOT restate a",
    "  finding you already put in `diseases`, and do NOT invent codes. No coded header",
    "  list yields an empty comorbidities array.",
    "- markers: one entry per GENUINELY QUANTIFIED imaging value the report states as a",
    "  number with a clear meaning over time — e.g. total CAC/Agatston score, a measured",
    "  dimension (common bile duct mm), a percent stenosis. Each:",
    "    • marker: a canonical name — name the SAME physical measurement",
    "      IDENTICALLY every time so it forms one trend line across reports. When",
    "      the value is one of these known markers, copy the name VERBATIM:",
    `        ${CANONICAL_IMAGING_MARKERS.join("; ")}.`,
    "      Only coin a new name for a measurement genuinely absent from that list,",
    "      and keep it terse and consistent.",
    "    • value: the number. unit: the unit, or '' for index/score-like values that have",
    "      no unit (mirroring how DEXA T/Z scores carry no unit).",
    "    • date: same study-performed date as above.",
    "    • group: a short modality/organ group (e.g. 'Cardiac Imaging', 'Liver Imaging').",
    "    • confidence: 0..1.",
    "  Do NOT fabricate a number for a qualitative finding (e.g. 'fatty liver' with no",
    "  grade is a disease entry, not a marker). A report with no quantified value yields",
    "  an empty markers array. Do NOT turn a CATEGORY or range into a single number: a",
    "  CAD-RADS stenosis category written as '1-24%' is a grade, not a measured 24% — it",
    "  belongs in the disease line, not as a numeric marker.",
    "- priorComparisons: the report's OWN explicit comparisons to a prior study — phrases",
    "  like 'increased from 10 to 14 mmHg', 'compared to 3.2 cm on 10/8/2021', 'prior",
    "  velocity 2.07 m/s'. Emit one ONLY when the report states BOTH a current value AND a",
    "  dated prior value for the same measurement. Each:",
    "    • marker: the canonical name, using the SAME rules and known-name list as",
    "      `markers` above, so the prior value joins that marker's single trend line.",
    "    • priorValue / currentValue: the two numbers (prior and current).",
    "    • priorDate: the prior study's date — ISO YYYY-MM-DD when the report gives one;",
    "      otherwise the report's own date text verbatim. unit: the unit (or '').",
    "    • confidence: 0..1.",
    "  Do NOT infer a prior value the report does not explicitly state, and do NOT invent a",
    "  date. A report that makes no explicit prior comparison yields an empty array.",
    "",
    `Patient: ${describeFactors(client)}.`,
  ].join("\n");
}

export async function proposeFromReport(
  anthropic: Anthropic,
  source: ReportSource,
  sourceFile: string,
  client: ReportPatient,
  today: string,
  model: string,
  usage?: UsageRecorder,
): Promise<ProposedReport> {
  const parsed = await readDocumentAsJson<ProposedReport>({
    anthropic,
    source,
    sourceFile,
    system: systemPromptFor(client, today),
    schema: REPORT_SCHEMA,
    instruction: "Extract the report as JSON.",
    model,
    maxTokens: 4096,
    usage,
  });
  validate(sourceFile, parsed);
  return parsed;
}

export function validate(sourceFile: string, r: ProposedReport): void {
  // The gate, checked before anything else: a document the model says is not a report has nothing
  // worth validating, and the reason is what the user needs to see. Only an EXPLICIT false rejects
  // — an extraction cached from before this field existed carries none and stays valid.
  if (r.isMedicalReport === false) {
    const why = r.notReportReason?.trim() || "it does not report a patient's own results";
    throw new Error(`report "${sourceFile}" is not a medical report: ${why}`);
  }
  if (typeof r.studyType !== "string" || r.studyType.trim() === "") {
    throw new Error(`report "${sourceFile}" missing studyType`);
  }
  if (!Array.isArray(r.diseases)) throw new Error(`report "${sourceFile}" diseases not an array`);
  if (!Array.isArray(r.comorbidities)) throw new Error(`report "${sourceFile}" comorbidities not an array`);
  if (!Array.isArray(r.priorComparisons)) throw new Error(`report "${sourceFile}" priorComparisons not an array`);
  if (!Array.isArray(r.markers)) throw new Error(`report "${sourceFile}" markers not an array`);
  for (const [i, d] of r.diseases.entries()) {
    if (!d.diagnostic || d.diagnostic.trim() === "") throw new Error(`report "${sourceFile}" diseases[${i}] missing diagnostic`);
    if (!d.summary || d.summary.trim() === "") throw new Error(`report "${sourceFile}" diseases[${i}] missing summary`);
    if (!d.date || d.date.trim() === "") throw new Error(`report "${sourceFile}" diseases[${i}] missing date`);
    if (!isConfidence(d.confidence)) throw new Error(`report "${sourceFile}" diseases[${i}] confidence out of [0,1]`);
  }
  for (const [i, c] of (r.comorbidities ?? []).entries()) {
    if (!c.label || c.label.trim() === "") throw new Error(`report "${sourceFile}" comorbidities[${i}] missing label`);
    if (typeof c.code !== "string") throw new Error(`report "${sourceFile}" comorbidities[${i}] code not a string`);
    if (c.description !== undefined && typeof c.description !== "string") throw new Error(`report "${sourceFile}" comorbidities[${i}] description not a string`);
    if (!isConfidence(c.confidence)) throw new Error(`report "${sourceFile}" comorbidities[${i}] confidence out of [0,1]`);
  }
  for (const [i, p] of (r.priorComparisons ?? []).entries()) {
    if (!p.marker || p.marker.trim() === "") throw new Error(`report "${sourceFile}" priorComparisons[${i}] missing marker`);
    if (!Number.isFinite(p.priorValue)) throw new Error(`report "${sourceFile}" priorComparisons[${i}] priorValue not finite`);
    if (!Number.isFinite(p.currentValue)) throw new Error(`report "${sourceFile}" priorComparisons[${i}] currentValue not finite`);
    if (!p.priorDate || p.priorDate.trim() === "") throw new Error(`report "${sourceFile}" priorComparisons[${i}] missing priorDate`);
    if (typeof p.unit !== "string") throw new Error(`report "${sourceFile}" priorComparisons[${i}] unit not a string`);
    if (!isConfidence(p.confidence)) throw new Error(`report "${sourceFile}" priorComparisons[${i}] confidence out of [0,1]`);
  }
  for (const [i, m] of r.markers.entries()) {
    if (!m.marker || m.marker.trim() === "") throw new Error(`report "${sourceFile}" markers[${i}] missing marker`);
    if (!Number.isFinite(m.value)) throw new Error(`report "${sourceFile}" markers[${i}] value not finite`);
    if (typeof m.unit !== "string") throw new Error(`report "${sourceFile}" markers[${i}] unit not a string`);
    if (!m.date || m.date.trim() === "") throw new Error(`report "${sourceFile}" markers[${i}] missing date`);
    if (!m.group || m.group.trim() === "") throw new Error(`report "${sourceFile}" markers[${i}] missing group`);
    if (!isConfidence(m.confidence)) throw new Error(`report "${sourceFile}" markers[${i}] confidence out of [0,1]`);
  }
}

function isConfidence(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}
