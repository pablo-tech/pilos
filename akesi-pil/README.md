# `@pablotech/akesi-pil`

*Ἀκεσώ — Akeso, daughter of Asclepius, goddess of the **process** of curing rather than the cure
itself; that was her sister Panacea's. The name is the disclaimer: this package builds the reasoning
and checks what comes back. It does not diagnose.*

Clinical reasoning over lab and marker data — unit normalization, reference-range lookup, treatment
bucketing, finding assembly — where **every constraint stated to the model in prose is re-enforced in
code on the response.**

The constraints worth enforcing are the ones a schema cannot state. Shape is largely the provider's
job now. What is left is the response that is valid JSON, every field the right type, and still files
clinical content under a body-system heading this patient does not have — where it is invisible in
every view organized by group. Assembling one finding raises 96 distinct refusals on four grounds —
shape, name, count and domain bounds — and the taxonomy is the substance of the package:
[`ARCHITECTURE.md` § *The response contract*](ARCHITECTURE.md#4-the-response-contract).

It is [`neuro-pil`](../neuro-pil)'s sibling, not its demonstration. This package does not import that
one and knows nothing about graphs; it is the workload the engine was extracted alongside, kept
separate to prove the engine is separable. A host is what joins them, hanging a derived node off each
finding so that changing a source — a marker's raw value, a reference range, a prompt template —
marks exactly the findings downstream of it as stale
([`../ARCHITECTURE.md`](../ARCHITECTURE.md#two-packages-no-edge-between-them)).

**Not medical advice.** Nothing in this package diagnoses, treats, or gives clinical guidance. It
assembles prompts and normalizes structured data for an LLM call an adopter supplies themselves;
what that call returns, and any decision made from it, is the adopter's responsibility to review
with a qualified clinician before acting on it.

## One patient, end to end

Everything below is quoted from this package's own checked-in fixtures — a synthetic patient named
`fullyPopulated` in [`tests/fixtures/canonical-variants.ts`](tests/fixtures/canonical-variants.ts),
and the prompt text it produces in
[`tests/fixtures/prompt-golden/`](tests/fixtures/prompt-golden/). The golden files are asserted
byte-for-byte by [`tests/prompt-golden.test.ts`](tests/prompt-golden.test.ts), so the rendered
output shown here cannot quietly drift away from what the code actually emits: if it changed, the
suite would be red. One exception, flagged where it appears: the grouping prompt in step 5 is
rendered from the same fixture but has no golden file, so it carries no such guarantee.

### 1. What arrives

Structured rows. Two lab results and three treatments, entered at different times by different
people, with no shared convention beyond the field names:

```ts
results: [
  { marker: "ApoB", group: "Lipids", source: "lab", date: "2026-01-01", value: 80,  unit: "mg/dL" },
  { marker: "LDL",  group: "Lipids", source: "lab", date: "2026-01-01", value: 120, unit: "mg/dL" },
],
treatments: [
  { id: "t1", name: "Ezetimibe", dose: "10 mg", kind: "drug", start: "2025-01" },
  { id: "t2", name: "Statin",                   kind: "drug", start: "2024-01", end: "2024-12" },
  { id: "t3", name: "Start rosuvastatin",       kind: "drug", start: "2099-02" },
],
```

Nothing here says which of those three the patient is currently taking, or what `80` means next to
`120`. That is the work.

### 2. Normalize the units, where a bug is a clinical error

`unit-systems.ts` converts a reading from its stored unit into the other measurement system on
read — never on write, because a stored value stays faithful to its source. Conversion is
**analyte-specific**, so the table is keyed by marker name:

```ts
"Apolipoprotein B": { us: "mg/dL", si: "g/L",     k: 0.01 },
"LDL-C":            { us: "mg/dL", si: "mmol/L",  k: 1 / 38.67 },
```

An adopter reading this table is entitled to expect our patient's ApoB to render as `0.8 g/L` under
a metric selector. It does not, and the reason is the rule that gives this package its character
([`unit-systems.ts:12-14`](unit-systems.ts)):

> **CLINICAL SAFETY:** only analytes with a VERIFIED factor are converted; anything else passes
> through in its stored unit, untouched, and is surfaced by `unmappedConvertible` + the coverage-gate
> test. **A missing conversion is safe; a wrong one is a clinical error.**

The patient's rows say `ApoB` and `LDL`. The table's keys are `Apolipoprotein B` and `LDL-C`. Those
are not the same string, so no factor is verified for these two readings and nothing is converted:

```ts
unmappedConvertible([
  { marker: "ApoB", unit: "mg/dL" },
  { marker: "LDL",  unit: "mg/dL" },
])
// → [ { marker: 'ApoB', unit: 'mg/dL' }, { marker: 'LDL', unit: 'mg/dL' } ]

unmappedConvertible([
  { marker: "Apolipoprotein B", unit: "mg/dL" },
  { marker: "LDL-C",           unit: "mg/dL" },
])
// → []
```

This is the design working, not failing. `unmappedConvertible` returns every `(marker, unit)` pair
whose *unit* is of a convertible class but whose *marker* has no rule — the gap made countable, so a
host can gate on it and a developer sees a console warning, rather than the gap being invisible until
someone reads a number in the wrong scale. A synonym table mapping `ApoB` → `Apolipoprotein B` is a
reasonable thing for a host to add; guessing that they mean the same analyte, inside the converter,
is not.

Downstream, the reading is rendered in the unit it was stored in, and says so:

```
ApoB (mg/dL)
  Last year (1 reading):
    2026-01-01: 80.0 mg/dL
  Prior: (no earlier data)
```

The one place conversion is *not* per-reading is `normalizeSeries`: a single marker's history may
mix units across dates, and a chart or an aggregate over mixed units is meaningless, so a series is
reconciled to a canonical SI unit before it is charted.

### 3. Bucket by time

`bucketOf` (`treatment-bucket.ts:38-42`) is nine lines and settles what the three treatment rows
mean, relative to a `today` the caller passes in rather than reads from the clock:

```ts
export function bucketOf(t: Pick<TreatmentItem, "start" | "end">, today: string): Bucket {
  if (t.end && cmp(t.end, today) < 0) return "past";
  if (t.start && cmp(t.start, today) > 0) return "planned";
  return "ongoing";
}
```

Against `today = "2026-06-28"`:

| Row | `start` | `end` | Bucket |
|---|---|---|---|
| Ezetimibe 10 mg | `2025-01` | — | `ongoing` |
| Statin | `2024-01` | `2024-12` | `past` |
| Start rosuvastatin | `2099-02` | — | `planned` |

`today` is a parameter because a prompt built from the same patient data must be reproducible: a
function that reads `Date.now()` produces a different prompt tomorrow for reasons that have nothing
to do with the patient, and a golden test over it could only ever be flaky.

### 4. What the model actually sees

`buildUserMessage` (`finding-generate.ts:259`) renders the bucketed rows into the prompt. This block
is verbatim from
[`tests/fixtures/prompt-golden/user--finding--fullyPopulated.txt`](tests/fixtures/prompt-golden/user--finding--fullyPopulated.txt):

```
Treatment History:
Ongoing regimen (currently being taken — assess each in `treatment`):
  - Ezetimibe 10 mg [since 2025-01]
Past / discontinued treatments (historical context only — do NOT assess these in `treatment`):
  - Statin [2024-01–2024-12]
```

The planned one is not in that section at all. It appears under its own `Patient Plan` heading,
which instructs the model to *"Assess the plan AS A WHOLE in `planAssessment`; do NOT let it
influence progression / disease / treatment analysis"*:

```
  - Action: "Start rosuvastatin"  (timing: 2099-02)
```

Three undifferentiated rows went in. What comes out is three *different kinds of fact*, each fenced
off from the others with a stated reason. That fencing is the package's actual output: not a
cleverer query, but one in which the model cannot mistake a drug the patient stopped eighteen
months ago for one they are on.

### 5. The round trip that has to converge

The finding above is one prompt and one answer. The marker-grouping surface is the other shape this
package uses, and it is the more instructive one: a bounded loop that keeps re-asking until every
marker has a home.

`runMarkerGroupingPasses` (`marker-groups-prompt.ts:174`) asks the model to place every marker under
one of the patient's body systems, listed in the prompt under the heading *"BODY SYSTEMS (assign
every marker to one of these, **verbatim**)"*. For our patient, `contextBlock` renders:

```
MARKERS TO ASSIGN (place every one of these exactly once):
  - ApoB [watchlist] (latest 80 mg/dL)
  - LDL [watchlist] (latest 120 mg/dL)

PURSUED STUDIES (assignment hints):
  - Suspicion: CVD
```

The answer is not trusted. `reconcileGroups` drops any group name the model did not take verbatim —
dropped, not corrected, because an invented heading is a mis-filing rather than a typo — keeps the
first placement of each marker, and sweeps anything still unplaced into an explicit
`"Not yet categorized"` bucket. Coverage is exactly-once by construction: no marker can be
duplicated across two systems, and none can silently vanish.

Then the loop, and the part worth stealing. Markers left over are re-asked — at most three more
times, over **only** the still-unplaced residue — and on those passes the escape hatch is taken away:

> These markers were NOT assigned on the first pass. EVERY marker below belongs to one of the
> systems above […] Do NOT output a `"Not yet categorized"` group — **it is not permitted in this
> response**; if a marker seems to fit no system, choose the one it relates to most.

The bucket still exists as a safety net in code — but it is no longer offered to the model as an
option, because an escape hatch left available becomes the answer. And the loop stops on *two*
conditions, not one: the residue reaching zero, or a pass placing nothing new. The second is the one
people forget. A model that has failed to place a marker twice will keep failing, and the third
attempt costs exactly as much as the first.

### 6. What comes back, and what is checked

`assembleFinding` (`finding-assemble.ts:669`) takes the model's parsed response and builds the
stored `ClientFinding`. Before it does, `validate` refuses a response that is internally
inconsistent with the prompt that produced it — not merely malformed JSON, but well-formed JSON
that does not line up with what was asked.

Our patient has two note entries, one of which is blank; `populatedNoteEntries` drops the blank, so
the prompt presents exactly one note. A note has no short label the model could echo back, so
results are zipped back **positionally**, which only works if the count matches:

```
noteResults must have exactly one entry per populated Note, in order (expected 1, got 2)
```

The same discipline runs through the rest: a `studyResults` entry whose `group` is not one of the
disease groups is rejected by name, a `disease` array with fewer than four areas is rejected, a
`treatment` array over thirty entries is rejected. A structurally inconsistent answer throws
instead of being stored — because a wrong association between a note and its result is not a
display bug, it is a clinical record that says something nobody said.

*Demonstrated by:* [`tests/finding-validate.test.ts`](tests/finding-validate.test.ts) §
*noteResults pairs to notes by position, so the count is the contract* — one case per direction
(a result too many, a result too few), each red when the count check is removed. The count of
refusals this section describes is not maintained by hand either:
[`tests/refusal-count.test.ts`](tests/refusal-count.test.ts) derives it from `finding-assemble.ts`
and fails every document that states a different one.

## Seven prompts, one discipline

The walk above follows one of them. The package has **seven** schema-constrained prompt surfaces, and
they all work the same way: the prompt states a constraint in prose, and code re-enforces it on the
response without consulting the prompt.

| Surface | What it asks for | What enforces the answer |
|---|---|---|
| Finding | The whole clinical reasoning unit — disease areas, treatments, studies, notes | `finding-assemble.ts` — 96 distinct refusals |
| Marker grouping | Every marker filed under one body system | `GROUPS_SCHEMA` + `reconcileGroups`, then the loop in step 5 |
| Reference ranges | Age/sex-appropriate ranges for the patient's markers | `RANGE_SCHEMA` |
| Report extraction | Structured markers out of a lab report | `REPORT_SCHEMA` |
| Document read | Structured JSON out of an arbitrary document | `DOCUMENT_READ_SCHEMA` |
| Treatment inference | A product label read as a label, not as a dose | `TREATMENT_INFER_SCHEMA` + the dose rule below |
| Treatment regrouping | Existing treatments re-filed under changed groups | `TREATMENT_GROUPS_TOOL` + `validateRegroup` |

The first row is the one that says the most. It is the largest surface and the only one with **no**
schema: it asks for strict JSON in prose. Structured output can guarantee that a field is a string —
it cannot guarantee that the string is a group name the model was given rather than one it made up,
that answers came back in the order the queries were put, or that a dose was read off a label
instead of inferred. Where the constraint is semantic, the only place to enforce it is code. That is
why the surface with no schema is also the surface with ninety-six refusals.

Four of the seven have golden fixtures. The gap and the reasoning are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.

## Measured

One benchmark in this package has been run on real model calls: two retry-correction strategies
over twelve synthetic cases, scored by the package's own `validate()`. Every attempt passed on the
first try, which says the Ranges prompt is strong and says nothing about the strategies.
[`BENCHMARKS.md`](../BENCHMARKS.md#sampled--akesi-pil) has the numbers — the only place this repo
keeps one.

## When the model gets it wrong

`generateFindingResponse` (`finding-generate.ts:1363`) retries a rejected finding with a correction
appended. Three details of how it does that were each paid for by a real run.

**Every prior rejection is accumulated, not just the latest.** One run burned all six attempts it was
then allowed: attempt 4 failed on a duplicate marker group, 5 on a bad data-requisition group, 6 on a
`doctorConversation` label. Each correction named exactly one problem; the model fixed that problem
and broke a different one, and never once saw the accumulated list. A correction that replaces its
predecessor teaches the model to oscillate between two failures forever.

*Measured:* not this claim. Both strategies were run against twelve synthetic cases on two models
and **not one of the 72 attempts was rejected** — good news about the Ranges prompt, and no evidence
either way about accumulating corrections, because with nothing to correct both strategies sent
identical prompts. The paragraph above still rests on the single run that produced it
([`BENCHMARKS.md`](../BENCHMARKS.md#sampled--akesi-pil)).

**The ceiling is three attempts, and the number is cost-derived.** Each attempt is a whole Opus
generation — roughly $5 and several minutes. Six of them bought nothing on the run above, so the
bound came down rather than the corrections getting cleverer. A retry budget that is not priced is
not a budget.

**`onAttemptFailed` reports each rejection to the caller**, for two reasons that belong together. A
silent retry is indistinguishable from a hang — a live check once ran 32 minutes with nothing on
screen to say whether it was working or wedged. And the rejection message can name a treatment or a
study, which makes it PHI-adjacent: the package hands it to the caller rather than logging it, and
takes no view on where it may go. Observability and disclosure are the same decision here, and it is
not this package's to make.

## The dose rule

The most important logic in this package is not code. `treatment-infer.ts:121-135` is a prompt
paragraph, and it exists because a model reading a supplement label will otherwise report the
label's contents as the patient's intake:

> **THE DOSE RULE — the one that matters most:**
> An ingredient amount is a LABEL FACT about the product: what ONE capsule, tablet or serving
> contains. It is NOT how much the patient takes. […] A product containing 100mcg of selenium, or a
> label suggesting 1 capsule daily, tells you nothing about what THIS patient takes — the patient's
> own quantity, frequency and time of day are entered separately, after this step, and may differ
> from what the label suggests. **Your job stops at the label.**

An extraction step that quietly promotes "100mcg per capsule" into "patient takes 100mcg" produces
a record that reads as a clinical history and is a guess. The rule is stated at length, in the
prompt, rather than left to be inferred — the domain knowledge is the deliverable, and here it
happens to be English rather than TypeScript.

## Where `neuro-pil` comes in

None of this package's own code decides *when* a finding regenerates — that policy (which source
change invalidates which derived output, and what triggers a rerun) belongs to the host's
`neuro-pil` `Dag`. Declare each finding as a `derived` node whose `inputs` are its source markers,
ranges and prompt template, and `driftedKeys` tells you exactly which findings a given source edit
stales. Correcting our patient's ApoB from `80` to `85` stales every finding that read it, and
nothing else.

Between the two packages the patient's finding acquires two independent stamps, and the pair is the
point. `neuro-pil` stamps what the finding was derived *from*; the [brain](../README.md#what-this-is-for)
that produced it — its prompt, its schema, and the model that answered — is stamped by its own version
key. A stored finding is still trustworthy only when **both** hold. It can be fresh on one and stale on
the other: nobody has touched the patient's markers, but the reasoning that read them was replaced last
Tuesday.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#8-the-hosts-job-a-brain-registry) for how a host layers a
brain registry and an event log on top of that staleness signal, and
[`../neuro-pil/compare.ts`](../neuro-pil/compare.ts)'s `compareBrains` for scoring competing prompt
versions against a fixed case set once you have more than one.

## Module map

- **Normalization** — `unit-systems.ts`, `dates.ts`, `ranges.ts` / `ranges-prompt.ts`: converting
  raw lab/marker values and dates into a comparable, unit-consistent shape, and rendering reference
  ranges into prompt-ready text.
- **Domain registries** — `item-registry.ts`, `system-groups.ts`, `imaging-catalog.ts`,
  `section-labels.ts`: static tables mapping raw report vocabulary (marker names, body systems,
  imaging modalities) onto the labels a prompt or a UI needs.
- **Marker grouping** — `marker-groups-prompt.ts`: the prompt and JSON schema for assigning every
  marker to a body system, plus `reconcileGroups`, which drops any group name the model did not take
  verbatim from the allowed systems and guarantees exactly-once coverage, and
  `runMarkerGroupingPasses`, which re-prompts only the still-unplaced markers (at most three times,
  stopping early when a pass places nothing new). The model call itself is injected by the caller.
- **Treatment logic** — `treatment-normalize.ts`, `treatment-bucket.ts`, `treatment-product.ts`,
  `treatment-infer.ts`, `treatment-timing-rules.ts`: turning a free-text treatment/medication entry
  into a normalized, bucketed, timing-aware structure.
- **Document ingestion** — `document-model.ts`, `document-read.ts`, `report-extract.ts`,
  `report-merge.ts`, `report-title.ts`, `ingest-core.ts`, `parsers-report.ts` (Node-only, `./pdf-node`):
  turning a source document (a lab report PDF, in the reference implementation) into the structured
  form the rest of the package operates on.
- **Finding construction** — `finding-generate.ts`, `finding-assemble.ts`, `finding-regroup.ts`,
  `marker-deltas.ts`, `pinned-queries.ts`, `factors-edit.ts`: building the actual LLM prompt for one
  reasoning unit ("finding") from its source data, and assembling/regrouping the model's structured
  response.
- **Benchmarks** — `benchmarks/retry-corrections.ts`: a synthetic case set, two correction
  strategies and the retry loop that runs them, scored by this package's own shipped `validate()`
  rather than by a rubric written to be passed. Not exported from the package root, and never part
  of `npm test` — running it costs real model calls. It constructs no client either: the cases and
  the scorer are data, and a host supplies both the SDK instance and the comparison loop. See
  [`BENCHMARKS.md`](../BENCHMARKS.md#sampled--akesi-pil).

## Importing

**The package root exports nothing.** `index.ts` is a comment and `export {};` — there is no barrel
file, deliberately: a barrel over twenty-nine modules would make every consumer's bundle depend on
all of them. Every import names its module directly, and the subpath is the module's own filename:

```ts
import { bucketOf, groupByName } from "@pablotech/akesi-pil/treatment-bucket";
import { unmappedConvertible, normalizeSeries } from "@pablotech/akesi-pil/unit-systems";
import { buildUserMessage, SYSTEM_PROMPT } from "@pablotech/akesi-pil/finding-generate";
import { assembleFinding } from "@pablotech/akesi-pil/finding-assemble";
import type { Client, TreatmentItem } from "@pablotech/akesi-pil/types";
```

Every subpath in [`package.json`](package.json)'s `exports` is isomorphic — safe in a browser
bundle, a Cloudflare Pages Function or a Node CLI alike — with **one** exception: `./pdf-node`
(`parsers-report.ts`) pulls in `pdfjs-dist`. It is the only Node-only entry point, and it is named
that way so importing it is a deliberate act rather than something a bundler discovers for you.

The package has **no runtime dependencies**. Its two external couplings — `@anthropic-ai/sdk` and
`pdfjs-dist` — are declared as *optional* peer dependencies, so installing `akesi-pil` pulls in
neither. Bring the SDK if you call one of the three model-issuing functions, and `pdfjs-dist` if you
import `./pdf-node`; importing `unit-systems` or `treatment-bucket` should not cost you a PDF parser
and an HTTP client, and it doesn't.

## Tests

`npm test` runs standalone — no credentials, no network, no vault access, no model call. The suite
asserts eighteen golden prompt fixtures byte-for-byte, so any change to prompt construction shows up
as a fixture diff rather than a silent pass. Regenerate them with `npm run prompt:golden` and review
the diff before committing.

`benchmarks/` is the one directory `npm test` does not run, because a benchmark issues real model
calls. Everything in it except the calls is still covered offline against scripted responses — the
retry loop, both strategies, the scorer and the statistics — because an instrument nobody has tested
is not a measurement. Those tests assert the accumulation itself, by recording every user message
the loop sends and requiring the third attempt to carry both earlier rejections under one strategy
and only the latest under the other; one asserts the module cannot reach a provider on its own.

One test in that file is not about prompts at all:

```ts
it("is generated from a synthetic roster and nothing else", () => {
  const NAMES = ["Bare", "Full", "Empty", "CLI"];
  const clients = [...Object.values(CANONICAL_VARIANTS).map((f) => f()), /* … */];
  expect(clients.length).toBeGreaterThan(NAMES.length);
  for (const c of clients) expect(NAMES).toContain(c.displayName);
});
```

Every fixture in this package is synthetic, and this package is published; a real person reaching a
golden file would be a PHI leak into an open-source artefact. The guard makes that a red build
rather than a matter of remembering.

It checks the generator's *input*, and that is the interesting part. The obvious guard is a denylist
— scan each fixture for the names that must never appear — and it was written that way first. But a
denylist has to spell out the names it is keeping out, which in a public repo discloses exactly what
it exists to protect, and it still passes for a person nobody thought to list. Checking the roster
instead names only synthetic values and catches every real one, because the two ends are already
tied: the goldens are pinned byte-for-byte to what this roster produces, so nothing reaches a fixture
without entering here first. An allowlist over a controlled input beats a denylist over its output.

## License

MIT — see [`LICENSE`](./LICENSE).
