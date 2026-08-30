import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Flatten a narrative report PDF (e.g. an Epic MyChart "Test Details" radiology
// report) to plain text. Unlike parseDexa, which keeps positional {str,x,y}
// items to read a fixed table, here we just want the prose for an LLM to read.
export async function extractReportText(bytes: Uint8Array): Promise<string> {
  // isEvalSupported:false is a real pdfjs runtime option (disables eval), just missing from the
  // legacy build's DocumentInitParameters typing — cast to the param type to keep it.
  const pdf = await getDocument({ data: bytes, isEvalSupported: false } as Parameters<typeof getDocument>[0]).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const parts: string[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      parts.push(it.str as string);
    }
    pages.push(parts.join(" "));
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
}
