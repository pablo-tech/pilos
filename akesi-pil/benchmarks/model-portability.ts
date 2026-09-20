// Scoring a FEATURE against a MODEL — the general answer to "does this run on anything but Claude?"
//
// The prompts in this package were written and checked against one vendor's models. That is an
// unmeasured claim the moment a deployer points a feature somewhere else, and the honest way to
// settle it is to run the shipped path and let the shipped validator judge the result. So the oracle
// here is never a rubric and never a second model: it is this package's own validate() — the same
// function that decides in production whether a response is usable at all.
//
// General on purpose. A probe is one feature's shipped call plus the cases to run it on, so
// measuring a NEW candidate model is a config edit in the host and measuring a NEW feature is one
// more Probe. Nothing in here names a vendor, a model or an endpoint.
//
// Cases come from the HOST, not from this file, for every probe but ranges: the fixtures a report or
// a document probe needs are documents, and ../../ARCHITECTURE.md is explicit that a host is what
// joins a package to its content. `tests/` is unpublished, so a benchmark that reached into it would
// work here and break for every consumer.
//
// Never part of `npm test`: it issues real model calls. No client is constructed here and no key is
// read — the host supplies both.
//
//   npx tsx benchmarks/model-portability.ts --preview   # the call budget, with no call made
import { fileURLToPath } from "node:url";
import type { MessagesClient } from "../model-client";
import type { Client } from "../types";
import { CASES, MAX_ATTEMPTS, VERSIONS, runCase, wilson, type RetryCase } from "./retry-corrections";
import { generateFindingResponse } from "../finding-generate";
import { proposeFromReport, type ReportPatient, type ReportSource } from "../report-extract";
import { readDocument } from "../document-read";
import { inferTreatment, type TreatmentInferInput } from "../treatment-infer";

/** Called once per rejection the shipped path RETRIED PAST. The final rejection of a failed run is
 *  the thrown error instead, so a reason is never counted twice. */
export type OnRejected = (reason: string) => void;

export interface Probe<C> {
  /** The feature name the host's inference config routes — "ranges", "extract", … */
  feature: string;
  cases: C[];
  label(c: C): string;
  /** How many attempts the SHIPPED path makes. 1 for a feature with no correction channel. */
  attempts: number;
  /** One run of the shipped path. Resolves when this package's own validator accepted the result. */
  run(anthropic: MessagesClient, model: string, c: C, onRejected: OnRejected): Promise<unknown>;
}

export interface ProbeOutcome {
  feature: string;
  model: string;
  label: string;
  ok: boolean;
  /** 1..probe.attempts when it validated; probe.attempts + 1 when it never did. */
  attempts: number;
  /** Every rejection in order — the validator's own words, which is what makes a flat result usable. */
  rejections: string[];
  ms: number;
}

/** The score for a case that never validated: one worse than the ceiling, so "failed" orders after
 *  "succeeded on the last attempt" without pretending to know how many more it would have needed. */
export function censored(probe: { attempts: number }): number {
  return probe.attempts + 1;
}

export async function runProbeCase<C>(anthropic: MessagesClient, model: string, probe: Probe<C>, c: C): Promise<ProbeOutcome> {
  const rejections: string[] = [];
  const started = Date.now();
  const base = { feature: probe.feature, model, label: probe.label(c) };
  try {
    await probe.run(anthropic, model, c, (r) => rejections.push(r));
    return { ...base, ok: true, attempts: rejections.length + 1, rejections, ms: Date.now() - started };
  } catch (e) {
    rejections.push((e as Error)?.message ?? String(e));
    return { ...base, ok: false, attempts: censored(probe), rejections, ms: Date.now() - started };
  }
}

/** Cases run in order, never concurrently: a self-hosted server answers one request at a time
 *  anyway, and overlapping calls would make the per-case latency meaningless. */
export async function runProbe<C>(anthropic: MessagesClient, model: string, probe: Probe<C>): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = [];
  for (const c of probe.cases) out.push(await runProbeCase(anthropic, model, probe, c));
  return out;
}

// Buckets keyed on the messages this package actually throws, so a bucket is a thing that happened
// rather than a category invented afterwards. Order matters: the first match wins.
const BUCKETS: [string, RegExp][] = [
  // Not quality at all. Kept first and reported separately, because a model that cannot be reached
  // or is refused the input scores zero and would otherwise read as a model that answers badly.
  ["unreachable", /fetch failed|ECONNREFUSED|ETIMEDOUT|socket hang up|network|502|503|504/i],
  ["unsupported", /cannot take|does not support|model_unsupported|unsupported/i],
  ["not a report", /is not a medical report/],
  ["wrong unit", /returned unit "[^"]*" but lab data is in/],
  ["missing imperial", /missing imperial explanation/],
  ["invalid JSON", /invalid JSON|not valid JSON/],
  ["no text block", /no text block/],
  ["truncated", /truncated \(hit max_tokens\)/],
  ["duplicate", /duplicate/i],
  ["unknown reference", /not (in|among)|unknown |never mentioned/i],
  ["missing field", /missing |must be |requires |empty/i],
];

export function bucketRejection(message: string): string {
  return BUCKETS.find(([, re]) => re.test(message))?.[0] ?? "other";
}

export interface FeatureScore {
  feature: string;
  model: string;
  n: number;
  passed: number;
  passRate: number;
  /** Wilson interval on passRate — the right interval at the small n a paid run can afford. */
  ci: [number, number];
  /** Validated on the very first attempt, with no correction. The number that says whether the
   *  prompt lands on this model, as opposed to whether the retry loop can rescue it. */
  firstAttemptPassRate: number;
  /** Over every case, censored failures included — reported next to passRate, never instead of it. */
  meanAttempts: number;
  medianMs: number;
  /** Most common first, with one real example, because a flat result is only actionable if you can
   *  see WHAT the model got wrong. */
  rejections: { bucket: string; count: number; example: string }[];
}

export function summarize(outcomes: ProbeOutcome[], probe: { feature: string; attempts: number }): FeatureScore {
  const n = outcomes.length;
  const passed = outcomes.filter((o) => o.ok).length;
  const first = outcomes.filter((o) => o.ok && o.attempts === 1).length;
  const ms = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const byBucket = new Map<string, { count: number; example: string }>();
  for (const o of outcomes) {
    for (const r of o.rejections) {
      const bucket = bucketRejection(r);
      const hit = byBucket.get(bucket);
      if (hit) hit.count++;
      else byBucket.set(bucket, { count: 1, example: r.slice(0, 200) });
    }
  }
  return {
    feature: probe.feature,
    model: outcomes[0]?.model ?? "",
    n,
    passed,
    passRate: n === 0 ? 0 : passed / n,
    ci: wilson(passed, n),
    firstAttemptPassRate: n === 0 ? 0 : first / n,
    meanAttempts: n === 0 ? censored(probe) : outcomes.reduce((s, o) => s + o.attempts, 0) / n,
    medianMs: n === 0 ? 0 : ms[Math.floor((n - 1) / 2)],
    rejections: [...byBucket].map(([bucket, v]) => ({ bucket, ...v })).sort((a, b) => b.count - a.count),
  };
}

// ---- the probes -------------------------------------------------------------------------------

/** ranges — the twelve SI-unit cases retry-corrections already justifies, run the way the app runs
 *  them: accumulate every rejection and try again, up to the shipped ceiling. */
export function rangesProbe(cases: RetryCase[] = CASES): Probe<RetryCase> {
  const [accumulate] = VERSIONS;
  return {
    feature: "ranges",
    cases,
    label: (c) => c.label,
    attempts: MAX_ATTEMPTS,
    async run(anthropic, model, c, onRejected) {
      const out = await runCase(anthropic, model, c, accumulate);
      // Everything but the last rejection of a failed run was retried past; the last one is thrown,
      // so runProbeCase records it once.
      const retriedPast = out.ok ? out.rejections : out.rejections.slice(0, -1);
      retriedPast.forEach(onRejected);
      if (!out.ok) throw new Error(out.rejections.at(-1) ?? "no attempt produced a response");
    },
  };
}

const FINDING_ATTEMPTS = 3;

/** finding — the whole assembled leaf, judged by the 90-odd throw sites in finding-assemble's
 *  validate(). The heaviest probe by far: one case is a full generation. */
export function findingProbe(clients: Client[]): Probe<Client> {
  return {
    feature: "finding",
    cases: clients,
    label: (c) => c.displayName,
    attempts: FINDING_ATTEMPTS,
    async run(anthropic, model, c, onRejected) {
      return generateFindingResponse(anthropic, c, model, undefined, (attempt, reason) => {
        if (attempt < FINDING_ATTEMPTS) onRejected(reason);
      });
    },
  };
}

export interface ExtractCase {
  label: string;
  source: ReportSource;
  sourceFile: string;
  patient: ReportPatient;
  today?: string;
}

/** extract — a report in, a validated ProposedReport out. The case carries its own source, so the
 *  SAME report can be scored as a native PDF on one model and as rendered pages on another. */
export function extractProbe(cases: ExtractCase[]): Probe<ExtractCase> {
  return {
    feature: "extract",
    cases,
    label: (c) => c.label,
    attempts: 1,
    run: (anthropic, model, c) =>
      proposeFromReport(anthropic, c.source, c.sourceFile, c.patient, c.today ?? new Date().toISOString().slice(0, 10), model),
  };
}

export interface DocumentCase {
  label: string;
  source: ReportSource;
  sourceFile: string;
}

/** document — the same documents read as prose rather than as a schema. */
export function documentProbe(cases: DocumentCase[]): Probe<DocumentCase> {
  return {
    feature: "document",
    cases,
    label: (c) => c.label,
    attempts: 1,
    run: (anthropic, model, c) => readDocument(anthropic, c.source, c.sourceFile, model),
  };
}

export interface TreatmentCase {
  label: string;
  input: TreatmentInferInput;
  maxTokens?: number;
}

/** treatmentText / treatmentImage — one probe, because they are one shipped call differing only in
 *  whether the input carries photos. Weak by construction: treatment-infer's validate() rejects only
 *  name and kind and NORMALIZES the rest, so a high pass rate here says less than it does elsewhere
 *  — which is the reason to report it next to the others rather than to leave it out. */
export function treatmentProbe(feature: string, cases: TreatmentCase[]): Probe<TreatmentCase> {
  return {
    feature,
    cases,
    label: (c) => c.label,
    attempts: 1,
    run: (anthropic, model, c) => inferTreatment(anthropic, c.input, model, c.maxTokens ?? 2048),
  };
}

// ---- budgeting --------------------------------------------------------------------------------

export interface Budget {
  feature: string;
  cases: number;
  maxCallsPerModel: number;
}

/** What a run would cost in calls, before any is made — the number --preview exists to print, and
 *  the one a pre-registration has to state. */
export function budget(probes: Probe<never>[], models = 1): Budget[] {
  return probes.map((p) => ({ feature: p.feature, cases: p.cases.length, maxCallsPerModel: p.cases.length * p.attempts * models }));
}

function main(): void {
  const probes = [rangesProbe()] as unknown as Probe<never>[];
  const lines = budget(probes).map((b) => `  ${b.feature.padEnd(16)} ${String(b.cases).padStart(3)} cases  ≤ ${b.maxCallsPerModel} calls per model`);
  process.stdout.write(
    "model-portability: feature × model, scored by this package's own validate().\n" +
      "Only the ranges probe carries its own cases; every other probe is built by the host from its\n" +
      "own fixtures (documents, patients, products), so the budget below is the floor, not the total.\n\n" +
      `${lines.join("\n")}\n\n` +
      "This module makes no calls itself; a host supplies the client, the model and the remaining cases.\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
