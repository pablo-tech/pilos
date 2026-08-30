// The two timing rules every treatment assessment must obey, in ONE place.
//
// They were previously written out twice — once in leaf-regen-registry.ts's per-node prompts (the
// Translate path) and once in finding-generate.ts's monolith prompt (the whole-Finding "↻ Translate"
// path) — in different formats, so a correction to one silently left the other wrong. Both had shipped
// the same two defects:
//
//   1. "the current dose is the most-recently-dated row" — which names a SCHEDULED FUTURE titration
//      step as current the moment one exists, reporting a drug at 6mg while 9mg is actually active.
//   2. Nothing required a named co-treatment to be real or concurrent, so an assessment could call a
//      stack "concurrent" by reading its constituents out of ANOTHER entry's name, months after it
//      had ended.
//
// Both prompt systems now interpolate these constants, so there is one wording to correct.

// Which row of a titration is the dose in force right now.
export const CURRENT_DOSE_RULE =
  "The CURRENT dose is the row whose window CONTAINS Today: its start is on or before Today AND it " +
  "either has no end or its end is on or after Today. This is NOT simply the latest-dated row. A row " +
  "that starts AFTER Today is a scheduled future step and is NOT the current dose, even though it is " +
  "the newest and even though it has no end date; a CLOSED range that contains Today IS the current " +
  "dose. If several rows contain Today, take the one with the latest start.";

// What must be true before another treatment may be named in an assessment.
export const CO_MENTION_RULE =
  "CO-MENTION DISCIPLINE — before naming any OTHER treatment, verify BOTH of the following against " +
  "the treatment list and drop the mention if either fails. (1) IT EXISTS AS ITS OWN ROW. Never infer " +
  "a treatment from words inside another entry's name: an entry called \"Glutathione stack (Glycine " +
  "20g/day and NAC 2g/day)\" is ONE row, and is NOT evidence that Glycine or NAC is separately on " +
  "record. Only a row that appears in its own right counts. (2) ITS WINDOW OVERLAPS the window you " +
  "are discussing. Read that row's own dates: a [Since X] row is active from X onward; a closed range " +
  "[X–Y] is active only between X and Y. Two treatments are concurrent ONLY if both are active at the " +
  "same time. If the other one ended before the item you are assessing started, or starts after it " +
  "ended, they never overlapped — say what you actually mean in the right tense (\"ran until May 2026, " +
  "so it no longer overlaps this dose\") or leave it out. NEVER write \"concurrent\", \"alongside\", " +
  "\"together with\", \"on top of\", or \"while also taking\" about a treatment whose window does not " +
  "overlap the one under discussion. An interaction you cannot date is an interaction you do not assert.";

// finding-generate.ts builds its prompt as an array of pre-wrapped lines rather than one long string,
// so the shared text is wrapped to a column and optionally indented to sit inside its section.
export function asPromptLines(rule: string, indent = "", width = 68): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of rule.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      out.push(indent + line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(indent + line);
  return out;
}

// How to speak about dose in each temporal bucket, and against what yardstick.
//
// Two failures this exists to stop, both seen live on the same drug. A PAST card was described as
// "ongoing since August 2025" with "the current 6 mg/week dose" — present tense and a "current" dose
// for a regimen that has ended, which is simply false. And a bucket is not one dose: Tirzepatide's
// past alone holds nine closed windows, so naming any single row "the dose" throws away the
// trajectory that is the actual clinical content.
export const BUCKET_DOSE_RULE =
  "DOSE IN CONTEXT — a treatment's rows are grouped by whether they are PAST, ONGOING or PLANNED, " +
  "and each group can hold SEVERAL rows, because a titration is one drug across many dose periods. " +
  "Never pick one row and call it \"the dose\"; read the group as a trajectory and say where it " +
  "started, where it ended, and how it moved. Then match your tense and your language to the group " +
  "you are discussing. PAST: every row has ended. Write entirely in the past tense and NEVER use " +
  "\"current\", \"currently\", \"is taking\", \"remains on\", or \"ongoing\" about it. The facts worth " +
  "stating are the range the dose covered, the highest dose reached, the final dose before it " +
  "stopped, how long it ran in total, and what the markers did across that span — not what the " +
  "patient is on now, which this group cannot tell you. ONGOING: the current dose is the row whose " +
  "window contains Today (see the rule above); earlier rows in the group are the path taken to reach " +
  "it, and a row starting after Today is a scheduled step, not the present. PLANNED: nothing is " +
  "being taken yet. Write in the future tense — \"is scheduled to start at\", \"will escalate to\" — " +
  "and never describe a planned dose as one the patient is on.";

// The yardstick the patient's own numbers should be read against.
export const STANDARD_DOSING_RULE =
  "STANDARD DOSING — when you discuss a dose, say where it sits against that drug's usual range, " +
  "when you know that range with confidence: its usual starting dose, its usual titration steps, and " +
  "its maximum or usual maintenance dose. Tirzepatide, for example, conventionally starts at 2.5 " +
  "mg/week and is titrated in 2.5 mg steps to a maximum of 15 mg/week; a patient at 7.5 mg/week is " +
  "mid-titration with room above, and one at 15 mg/week is at ceiling with no escalation left. That " +
  "placement is what makes a dose mean something: say plainly when a dose is sub-therapeutic, " +
  "mid-range, at the usual maximum, or above label, and when an escalation is available say what the " +
  "next conventional step is rather than inventing a target. If you do not know a drug's standard " +
  "range with confidence, say nothing about it rather than guessing — a wrong ceiling is worse than " +
  "no ceiling.";
