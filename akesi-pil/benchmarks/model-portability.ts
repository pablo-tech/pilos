// Scoring a FEATURE against a MODEL — the general answer to "does this run on anything but Claude?"
//
// The prompts in this package were written and checked against one vendor's models. That is an
// unmeasured claim the moment a deployer points a feature somewhere else, and the honest way to
// settle it is to run the shipped path and let the shipped validator judge the result. So the oracle
// here is never a rubric and never a second model: it is this package's own validate() — the same
// function that decides in production whether a response is usable at all.
//
// The probe loop, the censoring convention, the rejection bucketing and the scoring are NOT in this
// file. They are @promontory-studio/dokimasia, a domain-free harness extracted from the version that
// used to live here. What stays is everything that knows what a lab result is: the probes, their
// cases, and the rejection vocabulary this package's own validators throw. A probe cannot move into
// the harness for the same reason the harness could leave this package — the oracle is validate(),
// and validate() is ours.
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
import { budget } from "@promontory-studio/dokimasia/budget";
import { bucketRejection as bucketAgainst, withDefaults, type BucketTable } from "@promontory-studio/dokimasia/buckets";
import type { AnyProbe, Probe, ProbeOutcome } from "@promontory-studio/dokimasia/probe";
import { summarize as summarizeAgainst, type FeatureScore } from "@promontory-studio/dokimasia/score";
import type { Client } from "../types";
import { CASES, MAX_ATTEMPTS, VERSIONS, runCase, type RetryCase } from "./retry-corrections";
import { generateFindingResponse } from "../finding-generate";
import { proposeFromReport, type ReportPatient, type ReportSource } from "../report-extract";
import { readDocument } from "../document-read";
import { inferTreatment, type TreatmentInferInput } from "../treatment-infer";

// ---- this package's rejection vocabulary --------------------------------------------------------

// Keyed on the messages this package actually throws, so a bucket is a thing that happened rather
// than a category invented afterwards. Order matters and the first match wins — which is why the
// table goes through withDefaults rather than being written out: that prepends the harness's
// operational and response-shape buckets, so no edit here can put a quality reason ahead of
// "unreachable" and make a model that was never actually asked read as a model that answers badly.
export const BUCKETS: BucketTable = withDefaults([
  ["not a report", /is not a medical report/],
  ["wrong unit", /returned unit "[^"]*" but lab data is in/],
  ["missing imperial", /missing imperial explanation/],
  ["duplicate", /duplicate/i],
  ["unknown reference", /not (in|among)|unknown |never mentioned/i],
  ["missing field", /missing |must be |requires |empty/i],
]);

export function bucketRejection(message: string): string {
  return bucketAgainst(message, BUCKETS);
}

/** The harness's summarize with this package's buckets already bound, so a host scoring akesi's
 *  probes cannot accidentally report them against another domain's rejection vocabulary. */
export function summarize(outcomes: ProbeOutcome[], probe: { feature: string; attempts: number }): FeatureScore {
  return summarizeAgainst(outcomes, probe, BUCKETS);
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

function main(): void {
  const probes: AnyProbe[] = [rangesProbe()];
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
