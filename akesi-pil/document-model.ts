// The transport half of "send a document to Claude and get JSON back", lifted out of
// report-extract.ts so the structured report extraction and the new plain-prose document reading
// (document-read.ts) cannot drift apart in how they assemble content, cap output, or report a
// failure. Pure of Node/process/env for the same reason report-extract.ts is: a Node caller, an
// edge-runtime caller and a browser-facing relay all run the identical code path.
//
// The thrown message PREFIXES are load-bearing, not cosmetic: a caller separates "the model
// produced something unusable" from a transport error by matching on them. They are API.
import type { MessagesClient } from "./model-client";

// The document to read: already-extracted plaintext (a Node caller, via pdfjs; or a .txt/.md
// attachment read straight through), the raw PDF bytes as base64, which go to Claude as a native
// `document` block, OR the pages rendered to images. The third form exists because most
// OpenAI-compatible endpoints accept images but refuse a PDF file part: a vision model can still
// read the document, and rendering sends it what a human sees rather than a scrape of the text
// layer. The renderer is the caller's (an edge runtime has no pdfjs).
export type DocumentSource = { text: string } | { pdfBase64: string } | { pageImages: PageImage[] };

export interface PageImage {
  base64: string;
  /** image/jpeg or image/png — whatever the caller's renderer produced. */
  mediaType: string;
}

// Structural — a caller's own usage accumulator satisfies this, so no cost-accounting module is
// dragged in. Lives here rather than in report-extract.ts so both readers can record usage without
// importing the report module.
export interface UsageRecorder {
  // Field types mirror ModelUsage in model-client.ts (nullable numbers) so response.usage passes
  // straight through.
  record(
    model: string,
    usage:
      | {
          input_tokens?: number | null;
          output_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
          cache_read_input_tokens?: number | null;
        }
      | null
      | undefined,
  ): void;
}

export interface DocumentModelCall {
  anthropic: MessagesClient;
  source: DocumentSource;
  /** Only ever used to name the file in the prompt and in error messages. */
  sourceFile: string;
  system: string;
  /** JSON Schema. Index-signature shaped, which is what the SDK's output_config requires. */
  schema: { [key: string]: unknown };
  /** The instruction that accompanies the document, e.g. "Extract the report as JSON." */
  instruction: string;
  model: string;
  maxTokens: number;
  usage?: UsageRecorder;
}

/**
 * One document in, one validated-shape-free JSON object out. Callers own their own validation —
 * this only guarantees the response was a complete, parseable JSON body.
 */
export async function readDocumentAsJson<T>(call: DocumentModelCall): Promise<T> {
  const { anthropic, source, sourceFile, system, schema, instruction, model, maxTokens, usage } = call;

  // Document block first, text last — the ordering Anthropic recommends for document/image inputs,
  // and the one leaf-regen-anthropic.ts mirrors for images.
  const trailing = { type: "text" as const, text: `Document file: ${sourceFile}\n\n${instruction}` };
  const content =
    "text" in source
      ? `Document file: ${sourceFile}\n\n--- BEGIN DOCUMENT ---\n${source.text}\n--- END DOCUMENT ---\n\n${instruction}`
      : "pageImages" in source
        ? [
            ...source.pageImages.map((page, i) => [
              { type: "text" as const, text: `Page ${i + 1} of ${source.pageImages.length}:` },
              {
                type: "image" as const,
                source: { type: "base64" as const, media_type: page.mediaType as "image/jpeg", data: page.base64 },
              },
            ]).flat(),
            trailing,
          ]
        : [
            {
              type: "document" as const,
              source: { type: "base64" as const, media_type: "application/pdf" as const, data: source.pdfBase64 },
            },
            trailing,
          ];

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error(`extraction truncated (hit max_tokens) for "${sourceFile}" — raise max_tokens`);
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(
      `no text block in response for "${sourceFile}" — stop_reason=${response.stop_reason}, types=${response.content.map((b) => b.type).join(",")}`,
    );
  }
  let parsed: T;
  try {
    parsed = JSON.parse(textBlock.text) as T;
  } catch {
    throw new Error(`invalid JSON for "${sourceFile}": ${textBlock.text.slice(0, 200)}`);
  }
  usage?.record(model, response.usage);
  return parsed;
}
