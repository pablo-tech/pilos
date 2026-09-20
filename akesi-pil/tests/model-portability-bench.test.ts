import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { RangeAIResponse } from "../ranges-prompt";
import { CASES } from "../benchmarks/retry-corrections";
import {
  budget,
  bucketRejection,
  censored,
  documentProbe,
  extractProbe,
  rangesProbe,
  runProbe,
  runProbeCase,
  summarize,
  treatmentProbe,
  type Probe,
} from "../benchmarks/model-portability";

// The measurement is tested before it is billed. Everything here is the shipped path — the prompt
// builders, the retry loop and the validators that judge each attempt — with only the model
// scripted, so the arithmetic a published table rests on (pass rate, attempts, buckets) is proven
// against outcomes whose right answer is known.

/** A model that returns the given bodies in order, repeating the last. Serves both the create and
 *  the stream shapes, because finding streams and everything else does not. */
function scripted(bodies: unknown[]): Anthropic {
  let i = 0;
  const next = () => ({
    content: [{ type: "text", text: typeof bodies[Math.min(i, bodies.length - 1)] === "string" ? (bodies[i++] as string) : JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  return { messages: { create: async () => next(), stream: () => ({ finalMessage: async () => next() }) } } as unknown as Anthropic;
}

const VALID_RANGE: RangeAIResponse = {
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
const WRONG_UNIT = { ...VALID_RANGE, unit: "g/dL", low: 6.4, high: 8.2 } as RangeAIResponse;

const VALID_READING = { documentKind: "Lab report", isMedicalReport: true, notReportReason: "", text: "IMPRESSION: unremarkable." };
const NOT_A_REPORT = { ...VALID_READING, isMedicalReport: false, notReportReason: "it is a product label" };
const VALID_REPORT = {
  studyType: "Coronary CTA",
  diseases: [{ date: "2019-04-02", diagnostic: "CAC: 210", summary: "Proximal RCA calcified plaque.", confidence: 0.95 }],
  comorbidities: [],
  priorComparisons: [],
  markers: [{ marker: "Coronary artery calcium (CAC) score", value: 210, unit: "", date: "2019-04-02", group: "Cardiac Imaging", confidence: 0.98 }],
  isMedicalReport: true,
};
const PATIENT = { dob: "1980-01-01", gender: "male" as const, factors: { diseases: [] } };

const probe = rangesProbe([CASES[0]]);

describe("runProbeCase", () => {
  it("counts the attempt a first-try pass took, and records no rejection", async () => {
    const out = await runProbeCase(scripted([VALID_RANGE]), "m", probe, CASES[0]);
    expect(out).toMatchObject({ feature: "ranges", model: "m", ok: true, attempts: 1, rejections: [] });
  });

  it("counts a correction, and keeps the validator's own words for the one it retried past", async () => {
    const out = await runProbeCase(scripted([WRONG_UNIT, VALID_RANGE]), "m", probe, CASES[0]);
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.rejections).toHaveLength(1);
    expect(out.rejections[0]).toMatch(/unit "g\/dL" but lab data is in "g\/L"/);
  });

  it("censors a case that never validated, and records each reason exactly once", async () => {
    const out = await runProbeCase(scripted([WRONG_UNIT]), "m", probe, CASES[0]);
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(censored(probe));
    expect(out.attempts).toBe(4);
    expect(out.rejections).toHaveLength(3);
  });

  it("reports a reply that is not JSON at all as the model's failure, not as a crash", async () => {
    const out = await runProbeCase(scripted(["sorry, I cannot do that"]), "m", probe, CASES[0]);
    expect(out.ok).toBe(false);
    expect(bucketRejection(out.rejections[0])).toBe("invalid JSON");
  });
});

describe("summarize", () => {
  it("computes the rates over a known mix, and separates a first-try pass from a rescued one", async () => {
    const twelve = rangesProbe(CASES.slice(0, 2));
    const outcomes = [
      ...(await runProbe(scripted([VALID_RANGE]), "m", rangesProbe([CASES[0]]))),
      ...(await runProbe(scripted([WRONG_UNIT, VALID_RANGE]), "m", rangesProbe([CASES[1]]))),
      ...(await runProbe(scripted([WRONG_UNIT]), "m", rangesProbe([CASES[2]]))),
    ];
    const s = summarize(outcomes, twelve);
    expect(s).toMatchObject({ feature: "ranges", n: 3, passed: 2 });
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.firstAttemptPassRate).toBeCloseTo(1 / 3);
    // 1 + 2 + 4 (censored) over three cases.
    expect(s.meanAttempts).toBeCloseTo(7 / 3);
    expect(s.ci[0]).toBeLessThan(s.passRate);
    expect(s.ci[1]).toBeGreaterThan(s.passRate);
  });

  it("buckets the rejections, commonest first, with a real example attached", async () => {
    const outcomes = await runProbe(scripted([WRONG_UNIT]), "m", rangesProbe(CASES.slice(0, 2)));
    const s = summarize(outcomes, probe);
    expect(s.rejections[0].bucket).toBe("wrong unit");
    expect(s.rejections[0].count).toBe(6);
    expect(s.rejections[0].example).toMatch(/g\/dL/);
  });

  it("scores an empty run as censored rather than as a clean sweep", () => {
    const s = summarize([], probe);
    expect(s.passRate).toBe(0);
    expect(s.meanAttempts).toBe(4);
  });
});

describe("bucketRejection", () => {
  it.each([
    ["fetch failed", "unreachable"],
    ["this model cannot take PDF documents", "unsupported"],
    ['report "x.pdf" is not a medical report: it is a receipt', "not a report"],
    ['range for "Total Protein" returned unit "g/dL" but lab data is in "g/L"', "wrong unit"],
    ['range for "Total Protein" (unit g/L) missing imperial explanation', "missing imperial"],
    ['extraction truncated (hit max_tokens) for "x.pdf" — raise max_tokens', "truncated"],
    ["no text block in finding response", "no text block"],
    ['report "x.pdf" missing studyType', "missing field"],
    ["the sky is blue", "other"],
  ])("puts %j in %j", (message, bucket) => {
    expect(bucketRejection(message)).toBe(bucket);
  });

  it("does not read a transport failure as a quality failure", () => {
    expect(bucketRejection("fetch failed: ECONNREFUSED 127.0.0.1:11434")).toBe("unreachable");
  });
});

describe("the document probes", () => {
  const source = { pageImages: [{ base64: "AAA", mediaType: "image/jpeg" }] };

  it("passes a document the shipped validator accepts", async () => {
    const p = documentProbe([{ label: "one page", source, sourceFile: "report.pdf" }]);
    const [out] = await runProbe(scripted([VALID_READING]), "m", p);
    expect(out).toMatchObject({ feature: "document", ok: true, attempts: 1 });
  });

  it("fails a report the model itself says is not one — one attempt, no retry channel", async () => {
    const p = extractProbe([{ label: "one page", source, sourceFile: "label.pdf", patient: PATIENT }]);
    const [out] = await runProbe(scripted([NOT_A_REPORT]), "m", p);
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(2);
    expect(bucketRejection(out.rejections[0])).toBe("not a report");
  });

  it("passes a report the shipped validator accepts", async () => {
    const p = extractProbe([{ label: "cta", source, sourceFile: "cta.pdf", patient: PATIENT }]);
    const [out] = await runProbe(scripted([VALID_REPORT]), "m", p);
    expect(out.ok).toBe(true);
  });
});

describe("budget", () => {
  it("states the ceiling a pre-registration has to commit to, before a call is made", () => {
    const probes = [rangesProbe(), treatmentProbe("treatmentText", [{ label: "a", input: { text: "creatine 5g" } }])] as unknown as Probe<never>[];
    expect(budget(probes)).toEqual([
      { feature: "ranges", cases: 12, maxCallsPerModel: 36 },
      { feature: "treatmentText", cases: 1, maxCallsPerModel: 1 },
    ]);
    expect(budget(probes, 3)[0].maxCallsPerModel).toBe(108);
  });
});
