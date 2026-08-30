// A sampled benchmark on the one retry claim this package actually rests on: when an attempt is
// rejected, does sending EVERY prior rejection beat sending only the latest?
//
// README.md § "When the model gets it wrong" states it as fact — "the model fixed each named
// problem and broke a different one" — from a single six-attempt run. That is an anecdote, and an
// anecdote about a discipline that exists to catch failures cannot be checked in a regime where
// nothing fails. So the cases below are chosen to make the validator fire: lab units a model has a
// strong prior against (a lab reporting protein in g/L when the model wants g/dL), several of which
// ALSO require an imperial explanation. Two independent conditions is the structure the claim is
// about — fix one, break the other.
//
// Why this is the right subject where a binary rubric was not:
//   - it compares two strategies, which is the question compareBrains exists for;
//   - the outcome has a gradient (attempts until valid, censored), so it does not saturate;
//   - the verdict is the package's own shipped validate(), not a rubric written to be passed.
//
// The two strategies differ ONLY in what is passed to correctionSuffix — the same shipped function,
// the same wording, one list against its last element. So the comparison isolates accumulation and
// cannot quietly be measuring a reworded prompt. ../tests/retry-corrections-bench.test.ts asserts
// exactly that, offline.
//
// Never part of `npm test`: it issues real model calls. No client is constructed here and no key is
// read; the host supplies both, because ../../ARCHITECTURE.md is explicit that neither package
// imports the other and a host is what joins them.
//
//   npx tsx benchmarks/retry-corrections.ts --preview   # the prompt, both suffixes, the call budget
import type Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import { systemPromptFor, rangesUserMessage, RANGE_SCHEMA, validate, type RangeAIResponse } from "../ranges-prompt";
import { correctionSuffix } from "../finding-generate";
import type { Client } from "../types";

export const MAX_TOKENS = 1024;

/** The shipped ceiling. README.md § "When the model gets it wrong" derives it from cost, so the
 *  benchmark measures the loop that actually runs rather than an idealized unbounded one. */
export const MAX_ATTEMPTS = 3;

/** The score for a case that never validated. One worse than the ceiling, so "failed" is ordered
 *  after "succeeded on the last attempt" without pretending to know how many more it would need. */
export const CENSORED = MAX_ATTEMPTS + 1;

export interface RetryCase {
  label: string;
  client: Client;
  marker: string;
  /** What the lab reported in, and therefore what validate() requires back. */
  expectedUnit: string;
}

export interface Strategy {
  label: "accumulate" | "replace";
  /** What gets appended to the user message after `priorRejections` failed attempts. */
  suffix: (priorRejections: string[]) => string;
}

export const VERSIONS: Strategy[] = [
  // The shipped behaviour: every rejection so far.
  { label: "accumulate", suffix: correctionSuffix },
  // The plausible alternative, and what the two call sites sent before this was fixed: the latest
  // rejection only. Same function, so the wording is byte-identical for a given list.
  { label: "replace", suffix: (prior) => correctionSuffix(prior.slice(-1)) },
];

const DATES = ["2024-02-14", "2024-09-03", "2025-04-21", "2025-11-08", "2026-05-19"];
const GOALS = ["lower ApoB", "improve insulin sensitivity", "preserve lean mass", "lower inflammation"];
const FOCUS = ["cardiovascular", "metabolic", "body composition", "inflammatory"];

function labCase(
  i: number,
  marker: string,
  unit: string,
  dob: string,
  gender: "male" | "female",
  values: number[],
): RetryCase {
  const client: Client = {
    displayName: `Bench ${String(i).padStart(2, "0")}`,
    dob,
    gender,
    watchlist: [marker],
    results: values.map((value, j) => ({ marker, group: "Chemistry", source: "lab", date: DATES[j], value, unit })),
    factors: { goal: GOALS[i % GOALS.length], focus: FOCUS[i % FOCUS.length], athletic: "moderate" },
  };
  return { label: `${marker} in ${unit}`, client, marker, expectedUnit: unit };
}

// Twelve synthetic patients, no PHI. Every unit here is one a lab really reports and a model really
// tends to answer in something else — SI where the model reaches for conventional US units, and in
// four cases (g/L, cm, kg) a unit that ALSO makes explanationImperial mandatory. That second
// condition is the point: it is what lets an attempt fix the unit and lose the imperial line.
export const CASES: RetryCase[] = [
  labCase(1, "Total Protein", "g/L", "1958-03-11", "male", [68, 71, 70]),
  labCase(2, "Albumin", "g/L", "1990-07-22", "female", [42, 44, 43, 45]),
  labCase(3, "Hemoglobin", "g/L", "1975-01-05", "male", [148, 152, 150]),
  labCase(4, "Glucose", "mmol/L", "1982-11-30", "female", [5.1, 5.4]),
  labCase(5, "Total Cholesterol", "mmol/L", "1965-06-18", "male", [4.8, 5.2, 5.0, 4.9, 5.1]),
  labCase(6, "Triglycerides", "mmol/L", "1988-09-02", "female", [1.1, 1.3, 1.2]),
  labCase(7, "Creatinine", "µmol/L", "1970-04-14", "male", [82, 88, 85, 90]),
  labCase(8, "Vitamin D, 25-OH", "nmol/L", "1993-12-25", "female", [62, 71, 68]),
  labCase(9, "Ferritin", "µg/L", "1960-02-09", "male", [120, 145]),
  labCase(10, "Testosterone, Total", "nmol/L", "1978-08-17", "male", [15.2, 16.8, 14.9]),
  labCase(11, "Waist Circumference", "cm", "1985-05-27", "female", [82, 80, 79, 81]),
  labCase(12, "Body Weight", "kg", "1955-10-03", "male", [78.4, 77.1, 76.5]),
];

/** k independent samples per case, expressed as k copies of the case list. compareBrains scores a
 *  flat array, so replicates need no API change — and variance across identical cases is the only
 *  way to tell a real difference from one sampling run. */
export function withReplicates(cases: RetryCase[], k: number): RetryCase[] {
  return Array.from({ length: k }, (_, r) => cases.map((c) => ({ ...c, label: `${c.label} #${r + 1}` }))).flat();
}

export interface RetryOutcome {
  /** 1..MAX_ATTEMPTS when it validated; CENSORED when it never did. */
  attempts: number;
  ok: boolean;
  /** The validator's own messages, in order — what each strategy had available to send. */
  rejections: string[];
}

/** The retry loop, shaped exactly like generateFindingResponse's: build the message, call, validate,
 *  and on rejection append the validator's message and go again. The only thing the strategy
 *  changes is which of those messages the next attempt gets to see. */
export async function runCase(
  anthropic: Anthropic,
  model: string,
  c: RetryCase,
  strategy: Strategy,
): Promise<RetryOutcome> {
  const rejections: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPromptFor(c.client) }],
      output_config: { format: { type: "json_schema", schema: RANGE_SCHEMA } },
      messages: [{ role: "user", content: rangesUserMessage(c.client, c.marker) + strategy.suffix(rejections) }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    let parsed: RangeAIResponse | null = null;
    if (textBlock && textBlock.type === "text") {
      try {
        parsed = JSON.parse(textBlock.text) as RangeAIResponse;
      } catch (e) {
        rejections.push(`response was not valid JSON: ${(e as Error).message}`);
        continue;
      }
    }
    if (!parsed) {
      rejections.push("no text block in response");
      continue;
    }
    try {
      validate(c.marker, c.expectedUnit, parsed);
      return { attempts: attempt, ok: true, rejections };
    } catch (e) {
      rejections.push((e as Error).message);
    }
  }
  return { attempts: CENSORED, ok: false, rejections };
}

/** Attempts until the package's own validate() passed, censored at CENSORED. Lower is better —
 *  the one place in this repo where a lower mean is the better result, which BENCHMARKS.md says
 *  next to the table rather than leaving to be inferred. */
export function score(result: RetryOutcome): number {
  return result.attempts;
}

/** Reported alongside the mean, never instead of it: a mean over censored values hides a difference
 *  that is entirely in the failure rate. */
export function successRate(outcomes: RetryOutcome[]): number {
  return outcomes.length === 0 ? 0 : outcomes.filter((o) => o.ok).length / outcomes.length;
}

/** Wilson score interval — the right interval for a proportion at small n, where the textbook
 *  normal approximation puts the bound above 1 and reports [1.00, 1.00] for a clean sweep. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - half) / d), Math.min(1, (centre + half) / d)];
}

/** Exact two-sided sign test over the discordant pairs — the cases where the two strategies
 *  disagreed. Paired, because both strategies run the same case: the cases differ enormously in
 *  difficulty, and an unpaired comparison spends most of its power on that instead of on the
 *  strategy. Ties carry no information about direction and are excluded, which is the test. */
export function signTest(wins: number, discordant: number): number {
  if (discordant === 0) return 1;
  const tail = Math.min(wins, discordant - wins);
  let sum = 0;
  let c = 1;
  for (let i = 0; i <= tail; i++) {
    sum += c;
    c = (c * (discordant - i)) / (i + 1);
  }
  return Math.min(1, (2 * sum) / Math.pow(2, discordant));
}

/** The smallest number of discordant wins that would reach p < 0.05 — the minimum detectable
 *  effect, pre-registered rather than discovered afterwards. Returns Infinity when no split of
 *  `discordant` pairs can reach significance, which is the honest answer at very small n and the
 *  reason to compute it BEFORE spending on a run. */
export function minimumDetectableWins(discordant: number, alpha = 0.05): number {
  for (let w = Math.ceil(discordant / 2); w <= discordant; w++) if (signTest(w, discordant) < alpha) return w;
  return Infinity;
}

function main(): void {
  const replicates = process.argv.includes("--replicates") ? Number(process.argv[process.argv.indexOf("--replicates") + 1]) : 1;
  const cases = withReplicates(CASES, replicates);
  const rejections = [
    `range for "Total Protein" returned unit "g/dL" but lab data is in "g/L"`,
    `range for "Total Protein" (unit g/L) missing imperial explanation`,
  ];
  const [accumulate, replace] = VERSIONS;
  process.stdout.write(
    `retry-corrections: ${cases.length} cases × ${VERSIONS.length} strategies × up to ${MAX_ATTEMPTS} attempts ` +
      `= at most ${cases.length * VERSIONS.length * MAX_ATTEMPTS} calls\n` +
      `This module makes no calls itself; a host drives it through compareBrains (see BENCHMARKS.md).\n\n` +
      `--- the user message (case 1, attempt 1) ---\n${rangesUserMessage(CASES[0].client, CASES[0].marker)}\n\n` +
      `--- after two rejections, "${accumulate.label}" appends ---\n${accumulate.suffix(rejections)}\n\n` +
      `--- after the same two, "${replace.label}" appends ---\n${replace.suffix(rejections)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
