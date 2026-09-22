// The slice of a Messages-shaped client akesi actually calls, declared outright. The Anthropic SDK
// satisfies it as-is; so does an adapter that speaks another provider's API behind the Messages
// format, which is how a caller runs these call cores on a model that is not Claude.
//
// Nothing here is imported from a vendor SDK. akesi does not construct a client — the host passes one
// in — so it does not need the vendor's package to say what shape that client has, and after this it
// does not name the vendor in any file a consumer installs, imports or type-checks. What keeps the
// declaration honest is tests/client-port.test-d.ts, which assigns a real SDK client to
// MessagesClient and so fails the build the day the two drift apart, with the SDK a devDependency of
// that one test.
//
// Only what a CALLER reads is stated; everything else is left out or left open, so a
// provider-specific field (output_config, thinking, cache_control) passes through untouched. The
// three request shapes that really are vendor-specific are named in ARCHITECTURE.md § 6.
//
// @promontory-studio/dokimasia declares the same interface for the same reason. That is not
// duplication: both are independent statements of one external contract — the Messages request and
// reply shape — which neither package owns and neither imports. Structural typing makes them mutually
// assignable at zero coupling. Importing the harness's copy here would make akesi's *production*
// types depend on a benchmark harness.

/** Token counts, as nullable as the wire makes them: an adapter that reports neither still fits. */
export interface ModelUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface TextReplyBlock {
  type: "text";
  text: string;
}

/** Every block that is not text — thinking, a tool call, a server tool result, whatever a provider
 *  adds next. The discriminant is a pattern rather than a bare `string` for one reason: bare `string`
 *  keeps this member alive under a `type === "text"` test, and then `text` is not a string — which is
 *  exactly the read every call core here performs. Every non-text type in the contract today either
 *  contains an underscore or is `thinking`; one that is neither fails
 *  tests/client-port.test-d.ts, which is where it gets added. */
export interface OtherReplyBlock {
  type: "thinking" | `${string}_${string}`;
}

export type ReplyBlock = TextReplyBlock | OtherReplyBlock;

/** What a call core reads off a reply, and nothing more. No index signature: an interface has no
 *  implicit one, so a real SDK Message would stop being assignable to this the moment it gained one. */
export interface ModelReply {
  content: ReplyBlock[];
  stop_reason: string | null;
  usage: ModelUsage;
}

/** One request. model, max_tokens and messages are the three every Messages-shaped endpoint takes;
 *  the index signature carries the rest — output_config, thinking, a provider extension — through
 *  without this file having to enumerate it. The `any` in the three pass-through slots is deliberate:
 *  a request travels port -> provider, so a WIDER declared type is the error here, and `unknown` would
 *  make the port stricter than the contract it has to be accepted by. */
export interface ModelRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user" | "assistant"; content: string | any[] }>;
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } | null }>;
  tools?: any[];
  tool_choice?: any;
  [key: string]: unknown;
}

/** A streamed event, opaque on purpose: a finding run keeps the connection alive, it does not read
 *  deltas — see ARCHITECTURE.md § 6. */
export interface StreamEvent {
  type: string;
}

export interface MessagesStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<ModelReply>;
}

export interface MessagesClient {
  messages: {
    create(body: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelReply>;
    stream(body: ModelRequest, options?: { signal?: AbortSignal }): MessagesStream;
  };
}
