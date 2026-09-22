// The one file in this package that names a vendor, and the reason model-client.ts no longer has to.
// The port is declared by hand there; this is what stops it drifting from the contract it restates. A
// real SDK client is assigned to MessagesClient below, so `npm run check` goes red the day the SDK
// changes shape in a way the port does not allow — the same protection the deleted `import type` gave,
// now paid for with a devDependency instead of a published one.
//
// akesi keeps its own copy of this check rather than leaning on the identical one in
// @promontory-studio/dokimasia: akesi is the package that actually ships the calls, so its port is
// where drift bites, and borrowing the harness's proof would tie akesi's production types to a
// benchmark harness (ARCHITECTURE.md § 6).
//
// Type-level only: nothing here runs, and tests/ never ships (see `files` in package.json). The
// .test-d.ts name is deliberate — tsconfig.json's include covers it, vitest's default glob does not.
import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient, MessagesStream, ModelReply, ModelRequest, ReplyBlock } from "../model-client";

// ─── the port accepts the real client ───────────────────────────────────────────────────────────
const _fits: MessagesClient = null as unknown as Anthropic;
// Stated again one level down, so a drift report names the type that actually moved.
const _reply: ModelReply = null as unknown as Anthropic.Message;
const _blocks: ReplyBlock[] = null as unknown as Anthropic.ContentBlock[];
const _stream: MessagesStream = null as unknown as ReturnType<Anthropic["messages"]["stream"]>;

// ─── and an adapter that is not the SDK ─────────────────────────────────────────────────────────
// The other half of the claim: a port only one vendor can satisfy is a dependency in disguise.
const adapter = {
  messages: {
    create: async (body: ModelRequest): Promise<ModelReply> => ({
      content: [{ type: "text", text: String(body.model) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    stream: (): MessagesStream => {
      throw new Error("this adapter does not stream");
    },
  },
};
const _adapterFits: MessagesClient = adapter;

// ─── a caller can read a reply ──────────────────────────────────────────────────────────────────
// Both narrowing shapes a consumer actually writes. These compile only while `type === "text"` narrows
// to a block with a string `text`, which is the one thing every caller of the port depends on.
function _readsFirstBlock(reply: ModelReply): string {
  const block = reply.content[0];
  if (block?.type !== "text") throw new Error("no text block in response");
  return block.text;
}
function _findsTextBlock(reply: ModelReply): string {
  const block = reply.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error(`no text block, saw ${reply.content.map((b) => b.type).join(",")}`);
  return block.text;
}
const _body: ModelRequest = {
  model: "some-model",
  max_tokens: 1024,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  system: [{ type: "text", text: "be brief", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "lookup", input_schema: { type: "object" } }],
  tool_choice: { type: "auto" },
  output_config: { format: { type: "json_schema", schema: {} } },
  thinking: { type: "adaptive" },
};

// ─── and the port refuses a client that is not one ──────────────────────────────────────────────
// Each of these would make the checks above vacuous if it compiled. Each wrong client is named first,
// so what fails is structural assignability and not an excess-property check on a fresh literal.
const noStream = { messages: { create: async (): Promise<ModelReply> => ({ content: [], stop_reason: null, usage: {} }) } };
// @ts-expect-error — a client that cannot stream is not this port: a shipped path may use either call
const _n1: MessagesClient = noStream;

const noUsage = { messages: { create: async () => ({ content: [], stop_reason: null }), stream: adapter.messages.stream } };
// @ts-expect-error — a reply with no usage cannot be costed, and cost is half of what a run reports
const _n2: MessagesClient = noUsage;

const textlessBlock = { messages: { create: async () => ({ content: [{ type: "text" as const }], stop_reason: null, usage: {} }), stream: adapter.messages.stream } };
// @ts-expect-error — a text block carrying no text is the one thing every caller reads
const _n3: MessagesClient = textlessBlock;

const numericText = { messages: { create: async () => ({ content: [{ type: "text" as const, text: 42 }], stop_reason: null, usage: {} }), stream: adapter.messages.stream } };
// @ts-expect-error — text is a string, not whatever happens to parse
const _n4: MessagesClient = numericText;

const openBlocks = { messages: { create: async (): Promise<{ content: Array<{ type: string }>; stop_reason: null; usage: object }> => ({ content: [], stop_reason: null, usage: {} }), stream: adapter.messages.stream } };
// @ts-expect-error — blocks with an open discriminant cannot narrow, so no caller could read the text
const _n5: MessagesClient = openBlocks;

function _readsBlindly(block: ReplyBlock): unknown {
  // @ts-expect-error — text is reachable only after the `type === "text"` narrowing above
  return block.text;
}

const shortBody = { model: "some-model", messages: [{ role: "user" as const, content: "hi" }] };
// @ts-expect-error — max_tokens is not optional anywhere this port is spoken
const _n6: ModelRequest = shortBody;
