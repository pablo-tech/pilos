// Reading an attached document as PROSE — the general-purpose counterpart to report-extract.ts's
// structured extraction. Reports needs a schema (diseases/markers/comorbidities); a note, a chat
// turn or a treatment needs the document's own words, so they can be quoted and reasoned over.
//
// Text out, not a schema, because every consumer downstream wants something quotable: a leaf turn
// folds it in as context, chat discusses it, the UI shows how much was read. The one structured
// field that IS returned is `isMedicalReport` — the owner's decision that Reports must reject a
// non-report while Chat and Notes accept anything. Getting it from the same call the transcription
// comes from means the gate costs nothing extra.
import type Anthropic from "@anthropic-ai/sdk";
import { readDocumentAsJson, type DocumentSource, type UsageRecorder } from "./document-model";

// A transcription is bounded by the document, not by the model's inclination to keep writing; 16k
// output tokens is roughly 60 pages of dense clinical prose, comfortably past MAX_DOCUMENT_PAGES.
export const DOCUMENT_READ_MAX_TOKENS = 16_000;

// The page ceiling, checked in the browser BEFORE upload (attachment-store.ts, via pdf-render's
// openPdf().numPages). Without it a 200-page PDF is billed in full as input and only then fails on
// the output ceiling — you pay for everything and get nothing.
export const MAX_DOCUMENT_PAGES = 60;

export interface DocumentReading {
  /** A short human label for what the document is, e.g. "Radiology report", "Supplement label". */
  documentKind: string;
  /** True only for a clinical/lab/imaging report about a patient — the Reports import gate. */
  isMedicalReport: boolean;
  /** Present when isMedicalReport is false: one sentence saying what this is instead. */
  notReportReason?: string;
  /** The document's content as prose. */
  text: string;
}

/** What the R2 sidecar holds, and what /api/document-extract returns — the reading plus provenance. */
export interface StoredExtraction extends DocumentReading {
  at: string;
  chars: number;
  model?: string;
}

// How much of one document's text may ride along with a turn, and how much may in total. A
// transcription is bounded by MAX_DOCUMENT_PAGES, but a patient with several long documents on one
// leaf could still assemble a request larger than the relay's body cap — and unlike an image, text
// truncates gracefully. Truncation is always announced in the injected text, never silent.
export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_DOCUMENTS_TOTAL_CHARS = 150_000;

/** One document's extracted text, named, ready to ride along with a turn. */
export interface DocumentText {
  name: string;
  text: string;
}

/**
 * The per-document and total caps, applied.
 *
 * This was enforced in the BROWSER only (a host-side extraction client), so the caps described
 * two lines up as bounding "a request" bounded nothing a caller could not opt out of: the relay
 * validated `documents` for shape and passed it straight to Anthropic, leaving a CLI or a scripted
 * caller bounded by the 8 MB body cap alone — 8 MB of text into a prompt whose max_tokens assumes
 * far less. Same rule, same wording, both sides of the relay; the browser now calls this rather than
 * carrying its own copy of the arithmetic.
 *
 * Truncates rather than rejects, because a document that is too long is still worth reading most of,
 * and the cut is always announced IN the text so the model never treats an excerpt as complete.
 */
export function capDocuments(docs: DocumentText[]): DocumentText[] {
  const out: DocumentText[] = [];
  let budget = MAX_DOCUMENTS_TOTAL_CHARS;
  for (const d of docs) {
    const limit = Math.min(MAX_DOCUMENT_CHARS, budget);
    if (limit <= 0) break;
    const text = d.text.length > limit ? `${d.text.slice(0, limit)}\n\n[document truncated here — it is longer than this excerpt]` : d.text;
    budget -= Math.min(d.text.length, limit);
    out.push({ name: d.name, text });
  }
  return out;
}

/**
 * One prompt-ready block naming each document and quoting it, or "" when there are none.
 *
 * Pure, and here rather than in document-extract-client.ts, because both sides of the relay need
 * it: the browser to size a request, the Anthropic caller (leaf-regen-anthropic.ts, which also runs
 * from a Node CLI) to build the actual message. One wording, one place.
 */
export function documentsPromptBlock(docs: DocumentText[]): string {
  if (docs.length === 0) return "";
  return [
    "The patient attached the following document(s). Their contents were transcribed and are",
    "reproduced verbatim below. Treat them as evidence the patient has provided: you may quote them",
    "and rely on them, but do not infer beyond what they say, and do not treat a document's own",
    "claims as established clinical fact when it is not a clinical report.",
    "",
    ...docs.map((d) => `--- BEGIN DOCUMENT: ${d.name} ---\n${d.text}\n--- END DOCUMENT: ${d.name} ---`),
  ].join("\n");
}

export const DOCUMENT_READ_SCHEMA = {
  type: "object",
  properties: {
    documentKind: { type: "string" },
    isMedicalReport: { type: "boolean" },
    notReportReason: { type: "string" },
    text: { type: "string" },
  },
  required: ["documentKind", "isMedicalReport", "notReportReason", "text"],
  additionalProperties: false,
} as const;

export const DOCUMENT_READ_SYSTEM_PROMPT = [
  "You transcribe ONE attached document into plain text so it can be quoted and reasoned over",
  "later. You are a reader, not an interpreter: never add a finding, a conclusion, a diagnosis or a",
  "number the document does not itself contain.",
  "",
  "Return:",
  "- text: the document's content as readable prose, faithful to the original. Keep every heading,",
  "  label, date, value and unit exactly as printed — those are what a later step will quote. Render",
  "  a table as one line per row with its column labels, since the consumer sees text only. Keep the",
  "  document's own order. Do not summarize, do not shorten, do not editorialize, and do not add",
  "  commentary of your own. If part of the document is unreadable, write [unreadable] there rather",
  "  than guessing at it.",
  "- documentKind: a short Title Case label for what this document IS, e.g. 'Radiology report',",
  "  'Lab results', 'Supplement label', 'Insurance letter', 'Research paper', 'Receipt'.",
  "- isMedicalReport: true ONLY when this is a clinical report ABOUT A PATIENT that states results",
  "  — a lab panel, an imaging/radiology study, a pathology report, a diagnostic test result. It is",
  "  FALSE for a product label, a package insert, a research paper, a bill or an explanation of",
  "  benefits, an appointment letter, a consent form, marketing material, or anything not reporting",
  "  a patient's own measured results.",
  "- notReportReason: when isMedicalReport is false, ONE sentence naming what the document is",
  "  instead. Empty string when it is true.",
].join("\n");

export function validateReading(sourceFile: string, r: DocumentReading): void {
  if (!r || typeof r !== "object") throw new Error(`document "${sourceFile}" produced no object`);
  if (typeof r.text !== "string" || r.text.trim() === "") {
    throw new Error(`document "${sourceFile}" produced no text`);
  }
  if (typeof r.isMedicalReport !== "boolean") {
    throw new Error(`document "${sourceFile}" missing isMedicalReport`);
  }
  if (typeof r.documentKind !== "string") {
    throw new Error(`document "${sourceFile}" missing documentKind`);
  }
}

export async function readDocument(
  anthropic: Anthropic,
  source: DocumentSource,
  sourceFile: string,
  model: string,
  usage?: UsageRecorder,
): Promise<DocumentReading> {
  const reading = await readDocumentAsJson<DocumentReading>({
    anthropic,
    source,
    sourceFile,
    system: DOCUMENT_READ_SYSTEM_PROMPT,
    schema: DOCUMENT_READ_SCHEMA,
    instruction: "Transcribe this document as JSON.",
    model,
    maxTokens: DOCUMENT_READ_MAX_TOKENS,
    usage,
  });
  validateReading(sourceFile, reading);
  return reading;
}

// The prefixes readDocumentAsJson and validateReading throw with — everything here is the model
// failing to produce something usable, as opposed to a transport error worth retrying. A caller
// matches on this to decide which of the two it has, so the shape is API.
export const DOCUMENT_READ_FAILURE = /^document "|^extraction truncated|^invalid JSON for|^no text block/;
