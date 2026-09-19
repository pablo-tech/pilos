// The slice of the Anthropic client akesi actually calls, stated structurally. The SDK satisfies it
// as-is; so does an adapter that speaks another provider's API behind the Messages format, which is
// how a caller runs these call cores on a model that is not Claude.
import type Anthropic from "@anthropic-ai/sdk";

export interface MessagesStream extends AsyncIterable<Anthropic.RawMessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
    stream(body: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): MessagesStream;
  };
}
