import { describe, it, expect } from "vitest";
import { findingRequestParams, FINDING_MAX_TOKENS } from "@pablotech/akesi-pil/finding-generate";

// The adaptive-thinking heuristic and the token budget were once duplicated between this module
// and a caller, so a change to either had to be made twice or the two Findings diverged.
//
// The SHAPE is the thing to pin. While extracting this, an intermediate version returned the inner
// `{ type: "adaptive" }` and left callers to spread it — which type-checks, because the Anthropic
// request body is loosely typed, and would have emitted `type: "adaptive"` at the top level with no
// `thinking` key at all: adaptive thinking silently off, on the most expensive call in the app.
describe("findingRequestParams", () => {
  it("nests thinking under its own key, ready to spread into the request", () => {
    const p = findingRequestParams("claude-opus-4-7");
    expect(p).toEqual({ max_tokens: FINDING_MAX_TOKENS, thinking: { type: "adaptive" } });
    // Spreading it must produce a `thinking` key, not a bare `type`.
    const request = { model: "claude-opus-4-7", ...p };
    expect(request).toHaveProperty("thinking.type", "adaptive");
    expect(request).not.toHaveProperty("type");
  });

  it("omits thinking entirely for a non-Opus model", () => {
    const p = findingRequestParams("claude-sonnet-4-6");
    expect(p).toEqual({ max_tokens: FINDING_MAX_TOKENS });
    expect(p).not.toHaveProperty("thinking");
  });

  it("matches on the family, not an exact id", () => {
    expect(findingRequestParams("CLAUDE-OPUS-9-9")).toHaveProperty("thinking");
  });
});
