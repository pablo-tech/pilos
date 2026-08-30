// Regenerates tests/fixtures/prompt-golden/*.txt for this package's own prompt surfaces.
//
// Scoped to this package's own prompt builders — a host app's other prompt surfaces (e.g. a
// free-form chat prompt) stay in the host and out of this package's golden coverage.
//
// Plain .txt, one file per (builder, variant), NOT JSON — a reviewer sees a wording or whitespace
// change directly in `git diff`, which JSON's \n-escaping would hide.
//
// Run ONLY for a deliberate prompt change, and commit the regenerated files in the SAME commit as the
// change that caused them, with a message saying what moved and why.
//
//   npm run prompt:golden
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANONICAL_VARIANTS, RANGES_MARKER_CASES } from "./fixtures/canonical-variants";
import { buildUserMessage, SYSTEM_PROMPT } from "../finding-generate";
import { systemPromptFor as rangesSystemPrompt, rangesUserMessage } from "../ranges-prompt";
import { systemPromptFor as reportSystemPrompt } from "../report-extract";
import { SYSTEM_PROMPT as MARKER_GROUPS_PROMPT } from "../marker-groups-prompt";
import type { Client } from "../types";

/**
 * Every date-dependent value in the prompt is derived from this instant.
 *
 * buildUserMessage reads the current date in four places (patient age, the recent/prior marker split,
 * the six-month overdue tag, the literal `Today:` line) and ranges-prompt in two more. Without both a
 * frozen clock AND TZ=UTC (pinned in vitest.config.ts) the fixture changes on its own.
 */
export const FROZEN_NOW = new Date("2026-06-28T12:00:00Z");
export const FROZEN_TODAY = "2026-06-28";

export const DIR = fileURLToPath(new URL("./fixtures/prompt-golden/", import.meta.url));

/**
 * Runs `fn` with `Date` frozen at FROZEN_NOW.
 *
 * Owned here, and used by BOTH the generator and the test, so the two cannot disagree about what
 * "now" is.
 */
function withFrozenClock<T>(fn: () => T): T {
  const RealDate = Date;
  class Frozen extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(FROZEN_NOW.getTime());
      else super(...(args as ConstructorParameters<typeof Date>));
    }
    static now(): number {
      return FROZEN_NOW.getTime();
    }
  }
  globalThis.Date = Frozen as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** Every golden file this fixture covers, as name → the text it should contain. */
export function promptGolden(): Record<string, string> {
  return withFrozenClock(() => buildAll());
}

function buildAll(): Record<string, string> {
  const out: Record<string, string> = {
    "system--finding.txt": SYSTEM_PROMPT,
    "system--marker-groups.txt": MARKER_GROUPS_PROMPT,
  };
  for (const [variant, build] of Object.entries(CANONICAL_VARIANTS)) {
    const client = build() as Client;
    out[`user--finding--${variant}.txt`] = buildUserMessage(client);
    out[`system--ranges--${variant}.txt`] = rangesSystemPrompt(client);
    out[`system--report-extract--${variant}.txt`] = reportSystemPrompt(
      { dob: client.dob, gender: client.gender, factors: client.factors } as never,
      FROZEN_TODAY,
    );
  }
  for (const [name, build] of Object.entries(RANGES_MARKER_CASES)) {
    const { client, marker } = build();
    out[`user--ranges--${name}.txt`] = rangesUserMessage(client, marker);
  }
  return out;
}

function main(): void {
  mkdirSync(DIR, { recursive: true });
  for (const f of readdirSync(DIR)) if (f.endsWith(".txt")) rmSync(DIR + f);
  const files = promptGolden();
  for (const [name, text] of Object.entries(files)) writeFileSync(DIR + name, text.endsWith("\n") ? text : text + "\n");
  console.log(`wrote ${Object.keys(files).length} prompt golden file(s) to ${DIR}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
