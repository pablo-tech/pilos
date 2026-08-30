import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { RangeAIResponse } from "../ranges-prompt";
import {
  CASES,
  CENSORED,
  MAX_ATTEMPTS,
  VERSIONS,
  runCase,
  minimumDetectableWins,
  score,
  signTest,
  successRate,
  wilson,
  withReplicates,
} from "../benchmarks/retry-corrections";

// This benchmark's whole claim is that ACCUMULATING rejections differs from replacing them, so the
// thing worth asserting offline is that the loop really does accumulate — not merely that two
// strings differ. The model is the only part stubbed here; the retry loop, the prompt builder and
// the validator that decides each attempt are all the shipped implementations. No network, no key,
// no client constructed at module scope.

const VALID: RangeAIResponse = {
  low: 64,
  high: 82,
  unit: "g/L",
  meaning: "total circulating protein, a broad marker of nutritional status and liver synthesis",
  explanation: "this patient's readings sit mid-range and are stable across three draws",
  explanationImperial: "64 g/L is 6400 mg/dL and 82 g/L is 8200 mg/dL at the same scale",
  generalLow: 60,
  generalHigh: 83,
  generalExplanation: "the usual adult reference interval reported by most labs",
} as RangeAIResponse;

/** Rejected on the unit: what a model reaching for conventional US units returns. */
const WRONG_UNIT: RangeAIResponse = { ...VALID, unit: "g/dL", low: 6.4, high: 8.2 };
/** Rejected on the imperial line: the unit fixed, the other condition dropped. The oscillation the
 *  accumulate strategy exists to stop. */
const NO_IMPERIAL: RangeAIResponse = { ...VALID, explanationImperial: null } as RangeAIResponse;

/** A scripted model. Returns the given responses in order and records every user message it saw,
 *  which is what lets the accumulation itself be asserted rather than assumed. */
function scriptedClient(responses: RangeAIResponse[]): { client: Anthropic; seen: string[] } {
  const seen: string[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (req: { messages: { content: string }[] }) => {
        seen.push(req.messages[0].content);
        return { content: [{ type: "text", text: JSON.stringify(responses[Math.min(i++, responses.length - 1)]) }] };
      },
    },
  } as unknown as Anthropic;
  return { client, seen };
}

const [ACCUMULATE, REPLACE] = VERSIONS;
const c = CASES[0];

describe("the retry loop under each strategy", () => {
  it("stops as soon as the package's own validate() passes", async () => {
    const { client, seen } = scriptedClient([VALID]);
    const out = await runCase(client, "m", c, ACCUMULATE);
    expect(out).toMatchObject({ attempts: 1, ok: true, rejections: [] });
    expect(seen).toHaveLength(1);
  });

  it("retries with the validator's own message and reports the attempt it succeeded on", async () => {
    const { client } = scriptedClient([WRONG_UNIT, VALID]);
    const out = await runCase(client, "m", c, ACCUMULATE);
    expect(out.attempts).toBe(2);
    expect(out.ok).toBe(true);
    expect(out.rejections[0]).toContain('but lab data is in "g/L"');
  });

  it("gives up at the shipped ceiling and scores CENSORED, not a guess at how many more", async () => {
    const { client, seen } = scriptedClient([WRONG_UNIT, NO_IMPERIAL, WRONG_UNIT]);
    const out = await runCase(client, "m", c, ACCUMULATE);
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(CENSORED);
    expect(seen).toHaveLength(MAX_ATTEMPTS);
  });

  it("accumulate shows the third attempt BOTH earlier rejections", async () => {
    const { client, seen } = scriptedClient([WRONG_UNIT, NO_IMPERIAL, WRONG_UNIT]);
    await runCase(client, "m", c, ACCUMULATE);
    expect(seen[2]).toContain('but lab data is in "g/L"');
    expect(seen[2]).toContain("missing imperial explanation");
    expect(seen[2]).toContain("2 previous attempt(s)");
  });

  it("replace shows the third attempt only the latest — the failure mode being measured", async () => {
    const { client, seen } = scriptedClient([WRONG_UNIT, NO_IMPERIAL, WRONG_UNIT]);
    await runCase(client, "m", c, REPLACE);
    expect(seen[2]).toContain("missing imperial explanation");
    expect(seen[2]).not.toContain('but lab data is in "g/L"');
  });

  it("sends an identical message under both strategies until there are two rejections", async () => {
    // Otherwise the comparison would be measuring a reworded prompt from attempt 1 onward rather
    // than accumulation, and any difference in the means would be uninterpretable.
    const a = scriptedClient([WRONG_UNIT, NO_IMPERIAL, WRONG_UNIT]);
    const b = scriptedClient([WRONG_UNIT, NO_IMPERIAL, WRONG_UNIT]);
    await runCase(a.client, "m", c, ACCUMULATE);
    await runCase(b.client, "m", c, REPLACE);
    expect(a.seen[0]).toBe(b.seen[0]);
    expect(a.seen[1]).toBe(b.seen[1]);
    expect(a.seen[2]).not.toBe(b.seen[2]);
  });
});

describe("the case set", () => {
  it("is twelve synthetic patients, none derived from real data", () => {
    expect(CASES).toHaveLength(12);
    expect(new Set(CASES.map((x) => x.client.dob)).size).toBe(CASES.length);
    for (const x of CASES) expect(x.client.displayName).toMatch(/^Bench \d\d$/);
  });

  it("declares the unit the lab actually reported, which is what validate() then requires", () => {
    for (const x of CASES) {
      const rows = x.client.results.filter((r) => r.marker === x.marker);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.unit === x.expectedUnit)).toBe(true);
    }
  });

  it("includes cases with a second, independent condition — the structure the claim is about", () => {
    // g/L, cm and kg all make explanationImperial mandatory on top of the unit match. A case set
    // with one condition each could not produce the fix-one-break-another failure at all.
    const twoCondition = CASES.filter((x) => ["g/L", "cm", "kg"].includes(x.expectedUnit));
    expect(twoCondition.length).toBeGreaterThanOrEqual(4);
  });

  it("expands into replicates with distinct labels and no shared case objects", () => {
    const expanded = withReplicates(CASES, 3);
    expect(expanded).toHaveLength(36);
    expect(new Set(expanded.map((x) => x.label)).size).toBe(36);
    expect(expanded[0].marker).toBe(CASES[0].marker);
  });
});

describe("how a result gets reported", () => {
  it("scores attempts-until-valid, so lower is better and a failure sorts last", () => {
    expect(score({ attempts: 1, ok: true, rejections: [] })).toBe(1);
    expect(score({ attempts: CENSORED, ok: false, rejections: [] })).toBeGreaterThan(MAX_ATTEMPTS);
  });

  it("reports a success rate separately, because a censored mean hides a failure-rate difference", () => {
    const outcomes = [
      { attempts: 1, ok: true, rejections: [] },
      { attempts: CENSORED, ok: false, rejections: [] },
    ];
    expect(successRate(outcomes)).toBe(0.5);
    expect(successRate([])).toBe(0);
  });

  it("gives a Wilson interval that is not [1, 1] for a clean sweep at n=12", () => {
    // The instrument's resolution, made visible. Twelve out of twelve is a real result and its
    // lower bound is near 0.76 — so it must never be reported as "1.000", which reads as a
    // certainty the sample size cannot support. The interval is what keeps that honest.
    const [lo, hi] = wilson(12, 12);
    expect(hi).toBeCloseTo(1, 10);
    expect(lo).toBeGreaterThan(0.7);
    expect(lo).toBeLessThan(0.8);
  });

  it("widens as n falls and is symmetric about a half", () => {
    expect(wilson(6, 12)[1] - wilson(6, 12)[0]).toBeLessThan(wilson(3, 6)[1] - wilson(3, 6)[0]);
    const [lo, hi] = wilson(6, 12);
    expect(lo + hi).toBeCloseTo(1, 10);
  });
});

describe("the pre-registered detectable effect", () => {
  it("computes the exact two-sided sign test on known splits", () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 10)).toBe(1); // an even split is as unremarkable as it gets
    expect(signTest(10, 10)).toBeCloseTo(2 / 1024, 10);
    expect(signTest(9, 10)).toBeCloseTo(22 / 1024, 10);
  });

  it("names the smallest win count that would have reached significance", () => {
    // 8/10 gives p≈0.109 and 9/10 gives p≈0.021, so ten discordant pairs need nine.
    expect(minimumDetectableWins(10)).toBe(9);
    expect(signTest(minimumDetectableWins(10), 10)).toBeLessThan(0.05);
    expect(signTest(minimumDetectableWins(10) - 1, 10)).toBeGreaterThan(0.05);
  });

  it("admits when no result at that n could reach significance", () => {
    // Five discordant pairs cannot: even 5/5 is p=0.0625. Pre-registration is what surfaces that
    // before the calls are paid for rather than after.
    expect(minimumDetectableWins(5)).toBe(Infinity);
    expect(minimumDetectableWins(6)).toBe(6);
  });
});

describe("importing the benchmark reaches no provider", () => {
  it("takes its client as a parameter — with none, nothing can be called", async () => {
    await expect(runCase(undefined as never, "m", c, ACCUMULATE)).rejects.toThrow();
  });
});
