import { describe, it, expect, vi } from "vitest";
import { readDocumentAsJson } from "@pablotech/akesi-pil/document-model";
import {
  capDocuments,
  documentsPromptBlock,
  validateReading,
  DOCUMENT_READ_FAILURE,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENTS_TOTAL_CHARS,
  type DocumentReading,
} from "@pablotech/akesi-pil/document-read";
import { validate as validateReport, type ProposedReport } from "@pablotech/akesi-pil/report-extract";

function anthropicStub(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { messages: { create } } as never, create };
}

const ok = (payload: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 2 },
});

describe("readDocumentAsJson", () => {
  const base = { sourceFile: "x.pdf", system: "sys", schema: { type: "object" }, instruction: "Do it.", model: "m", maxTokens: 100 };

  it("sends a PDF as a native document block, with the text instruction last", async () => {
    const { client, create } = anthropicStub(ok({ a: 1 }));
    await readDocumentAsJson({ ...base, anthropic: client, source: { pdfBase64: "JVBERi0x" } });
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0x" } });
    expect(content[1].type).toBe("text");
  });

  it("sends already-extracted text as a plain string, with no document block", async () => {
    const { client, create } = anthropicStub(ok({ a: 1 }));
    await readDocumentAsJson({ ...base, anthropic: client, source: { text: "hello" } });
    const content = create.mock.calls[0][0].messages[0].content;
    expect(typeof content).toBe("string");
    expect(content).toContain("hello");
  });

  it("records usage when a recorder is supplied", async () => {
    const { client } = anthropicStub(ok({ a: 1 }));
    const record = vi.fn();
    await readDocumentAsJson({ ...base, anthropic: client, source: { text: "hi" }, usage: { record } });
    expect(record).toHaveBeenCalledWith("m", { input_tokens: 1, output_tokens: 2 });
  });

  // The three failure shapes below all have to keep matching DOCUMENT_READ_FAILURE (and
  // extract.ts's own regex), because that match is what makes them a 422 instead of a 502.
  it("throws a matchable error on truncation", async () => {
    const { client } = anthropicStub({ content: [], stop_reason: "max_tokens", usage: {} });
    await expect(readDocumentAsJson({ ...base, anthropic: client, source: { text: "hi" } })).rejects.toThrow(/extraction truncated/);
  });

  it("throws a matchable error when the response carries no text block", async () => {
    const { client } = anthropicStub({ content: [{ type: "tool_use" }], stop_reason: "tool_use", usage: {} });
    await expect(readDocumentAsJson({ ...base, anthropic: client, source: { text: "hi" } })).rejects.toThrow(/no text block/);
  });

  it("throws a matchable error on unparseable JSON", async () => {
    const { client } = anthropicStub({ content: [{ type: "text", text: "{not json" }], stop_reason: "end_turn", usage: {} });
    await expect(readDocumentAsJson({ ...base, anthropic: client, source: { text: "hi" } })).rejects.toThrow(/invalid JSON for/);
  });

  it("every thrown failure matches DOCUMENT_READ_FAILURE", () => {
    for (const m of [
      'document "x.pdf" produced no text',
      'extraction truncated (hit max_tokens) for "x.pdf" — raise max_tokens',
      'invalid JSON for "x.pdf": {',
      'no text block in response for "x.pdf" — stop_reason=end_turn, types=',
    ]) {
      expect(DOCUMENT_READ_FAILURE.test(m)).toBe(true);
    }
  });
});

describe("validateReading", () => {
  const good: DocumentReading = { documentKind: "Lab results", isMedicalReport: true, text: "CBC: normal" };

  it("accepts a complete reading", () => {
    expect(() => validateReading("x.pdf", good)).not.toThrow();
  });

  it("rejects an empty transcription — a document that read as nothing is a failure, not a result", () => {
    expect(() => validateReading("x.pdf", { ...good, text: "   " })).toThrow(/produced no text/);
  });

  it("rejects a missing isMedicalReport, since Reports' gate depends on it", () => {
    expect(() => validateReading("x.pdf", { ...good, isMedicalReport: undefined as never })).toThrow(/isMedicalReport/);
  });
});

describe("documentsPromptBlock", () => {
  it("is empty for no documents, so a turn with none is byte-identical to before", () => {
    expect(documentsPromptBlock([])).toBe("");
  });

  it("names and delimits each document so the model can attribute a quote", () => {
    const block = documentsPromptBlock([{ name: "labs.pdf", text: "LDL 120" }, { name: "notes.txt", text: "felt tired" }]);
    expect(block).toContain("--- BEGIN DOCUMENT: labs.pdf ---");
    expect(block).toContain("LDL 120");
    expect(block).toContain("--- END DOCUMENT: notes.txt ---");
  });
});

// W75 — the caps existed but lived in the browser, so the relay accepted whatever a non-browser
// caller sent. These assert the rule itself, on the shared helper both sides now call.
describe("capDocuments", () => {
  it("leaves ordinary documents exactly as they are", () => {
    const docs = [{ name: "labs.pdf", text: "LDL 120" }];
    expect(capDocuments(docs)).toEqual(docs);
  });

  it("truncates one over-long document and SAYS so, so the model never reads an excerpt as complete", () => {
    const [out] = capDocuments([{ name: "big.pdf", text: "x".repeat(MAX_DOCUMENT_CHARS + 5_000) }]);
    expect(out.text).toContain("[document truncated here");
    expect(out.text.startsWith("x".repeat(MAX_DOCUMENT_CHARS))).toBe(true);
  });

  it("spends a shared total budget, and drops what is left over rather than overflowing the prompt", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `d${i}.pdf`, text: "y".repeat(MAX_DOCUMENT_CHARS) }));
    const out = capDocuments(many);
    // 6 x 60k would be 360k against a 150k budget: two whole, a third cut to the remainder, the rest
    // dropped — the budget is spent, not exceeded.
    expect(out.length).toBe(3);
    expect(out[2].text).toContain("[document truncated here");
    const total = out.reduce((n, d) => n + d.text.length, 0);
    expect(total).toBeGreaterThan(MAX_DOCUMENTS_TOTAL_CHARS - 1);
    expect(total).toBeLessThan(MAX_DOCUMENTS_TOTAL_CHARS + 200);
  });
});

describe("the Reports import gate (report-extract validate)", () => {
  const report: ProposedReport = {
    studyType: "Coronary CTA",
    diseases: [],
    comorbidities: [],
    priorComparisons: [],
    markers: [],
  };

  it("refuses a document the model says is not a medical report, and says why", () => {
    expect(() =>
      validateReport("insert.pdf", { ...report, isMedicalReport: false, notReportReason: "it is a supplement package insert" }),
    ).toThrow(/is not a medical report: it is a supplement package insert/);
  });

  it("still refuses when no reason was given, rather than importing it", () => {
    expect(() => validateReport("x.pdf", { ...report, isMedicalReport: false })).toThrow(/is not a medical report/);
  });

  it("accepts a real report", () => {
    expect(() => validateReport("ct.pdf", { ...report, isMedicalReport: true })).not.toThrow();
  });

  it("accepts an extraction cached from before the gate existed (no isMedicalReport at all)", () => {
    expect(() => validateReport("old.pdf", report)).not.toThrow();
  });
});
