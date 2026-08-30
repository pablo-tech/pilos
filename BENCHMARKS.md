# Benchmarks

Every measured number in this repo lives here. The documents that make a claim link to the row that
checks it, so there is one place to correct and no second copy to go stale.

## What a row has to do to be on this page

**A row must measure the claim it is filed under, in the claim's own units.** `neuro-pil`'s central
trade-off is that *"a key whose stamp moved is reported stale even when regenerating it would have
produced the same answer"*. That is a claim about **output**. Only a corpus that computes outputs
can measure it; anything comparing graph structure against graph structure is measuring reachability
and filing it under a sentence about regeneration.

**A row must be able to come out differently for an implementation that is correct but different.**
This is the repo's *a test must be able to fail* rule, sharpened for measurement — and it is
stricter than mutation testing. Breaking the engine and watching a number move proves the row
*reads* the engine; it does not prove the row *discriminates*. A graph identity moves under mutation
too, while still scoring identically for every implementation that is correct. So each row below
names what a plausible alternative implementation would score, and
[`neuro-pil/tests/staleness-corpus.test.ts`](neuro-pil/tests/staleness-corpus.test.ts) asserts that
separation rather than claiming it. A row with no such answer is a tautology and does not belong
here.

**A discipline that exists to catch failures cannot be measured where nothing fails.** The strongest
model on easy cases saturates any rubric at the ceiling and returns no information. Choosing a
regime that actually produces failures is correct design, provided it is labelled.

**Nothing here is a threshold.** A benchmark that fails a build becomes something to be managed
rather than something to be read, and the rates below are *expected* to move when the code does.

Two kinds of evidence, not interchangeable:

| | `neuro-pil` | `akesi-pil` |
|---|---|---|
| The claim is about | a pure function over a graph | how a model behaves under a prompt |
| So the evidence can be | **deterministic** — exact, reproducible from a seed | **sampled** — with an interval, one model, one day |
| Costs | nothing; offline | real model calls |
| Runs in CI | yes, reported and never gated | never |
| Honest ceiling | "this is what the engine does" | "this is what one model did on n cases" |

Keeping them apart is the same discipline the rest of the repo argues for. *Validity is not
reproducibility* is `neuro-pil`'s central claim about stale values; it applies just as well to
evidence about the code itself. A number that reproduces exactly still only says what the engine
does, and a sampled mean does not become a proof by being written down next to one.

## Deterministic — `neuro-pil`

[`neuro-pil/benchmarks/staleness-corpus.ts`](neuro-pil/benchmarks/staleness-corpus.ts) generates
seeded random DAGs in which **every derived node carries a real derivation** — a pure function of
its inputs' values, mixing information-preserving families (a sum) with information-lossy ones (a
max, a threshold, a rounding, a parity).

Ground truth is therefore an **evaluation, never a graph walk**: evaluate every node, perturb,
evaluate again, and take the nodes whose value actually changed. That is what makes the two
quantities below mean what their names say. The lossy family is the realistic case — a clinical
"elevated / normal" verdict is a threshold over a number — and it is what produces genuine
over-approximation at all. A corpus of only preserving derivations reports precision of exactly
100% no matter how coarse the engine is.

```
cd neuro-pil && npm run bench
```

200 graphs of 24 nodes, seed 20260830. Every count below reproduces exactly from that seed.

**Missed** is a node whose output genuinely changed and was not reported stale — unsoundness, and
the package's whole premise is that it stays at zero. **Unnecessary** is a node reported stale whose
output is byte-identical — a regeneration that would have been paid for nothing.

Every rate is taken over the nodes something has to **produce**: the sixteen derived and leaf nodes
in each graph, not the eight sources. A source is edited, not regenerated, and counting the one you
just edited as a correctly reported stale node would flatter every rate below.

### The guarantee — nothing that changed goes unreported

| Condition | Output changed | Missed | Reported stale | Unnecessary |
|---|---|---|---|---|
| One source value edited | 565 | **0 (0.0%)** | 1001 | **436 (43.6%)** |
| An edit the slice normalizes away | 0 | **0** | 0 | **0** |

Row one is soundness: 565 outputs moved and every one of them was reported. Row two is the one place
the cost is bounded — whitespace and case collapsed inside a slice function never reach the hash, so
a cosmetic edit changes no output and triggers no regeneration at all.

### The price — 43.6% wasted, against 82.3% for regenerating everything

436 of the 1001 regenerations a source edit triggers would have produced the same answer. Whether
that is a scandal or a bargain depends entirely on what the alternative costs, so here is the
alternative, priced on the same corpus:

| Policy | Regenerated | Wasted | Missed |
|---|---|---|---|
| No tracking — regenerate everything | 3200 | **2635 (82.3%)** | 0 |
| `neuro-pil` | 1001 | **436 (43.6%)** | 0 |
| An oracle | 565 | **0 (0.0%)** | 0 |

All three miss nothing, so the comparison is about waste and nothing else. Against the policy you
have *without* this library, the engine removes **83.5% of the wasted regenerations** — 2635 down to
436.

The floor is unreachable rather than merely unbuilt. Skipping exactly those 436 means knowing which
regenerations would return an identical answer, which means computing them, and an LLM call is the
one derivation you cannot re-run to find out. That is the argument `neuro-pil/README.md` §
*What this trades away* makes against Adapton and Salsa, which re-run and discover nothing changed;
this table is that argument with a number attached.

### The two ways to lose the guarantee

| Condition | Output changed | Missed | Reported stale | Unnecessary |
|---|---|---|---|---|
| Every derivation rewritten, sources untouched | 2419 | **2419 (100.0%)** | 0 | **0** |
| The same rewrite, derivation declared as a source | 2419 | **0 (0.0%)** | 3200 | **781 (24.4%)** |
| The source edit again, that source's slice removed | 565 | **565 (100.0%)** | 0 | **0** |

**The first way is by design.** Rewriting every derivation moves 2419 outputs and the engine reports
none of them: it hashes sources, and a derivation is not a source. Declare the derivation as a
source node and the same rewrite reports all 2419 — the whole remedy `neuro-pil/README.md` § *What
this does not catch* offers, on the same corpus with that one change. Its cost is row two's last
column: because the corpus rewrites *every* derivation at once, every node is downstream of a
change and all 3200 are reported, of which 781 came back identical anyway.

**The second way is misuse.** Row three is the same edit as the source-edit row above with one
source's slice function deleted, and the engine reports zero of the 565 nodes that moved. It fails
silently, because a source nothing hashes is indistinguishable from a source that did not change.
That is what `sliceParity` is for, and it names the missing slice in **200/200** graphs.

### Three further rows, each pricing something previously stated without a number

| | Measured | What a different implementation would score |
|---|---|---|
| A deleted node is never reported stale | **0/200 reported** | A comparison walking the union of both key sets reports it — asserted in-test. So 0/200 is a fact about this engine, not about staleness. |
| 48-bit truncation collision risk | **0 collisions in 3296 stamps**; birthday bound **0.0018% at 10⁵**, **0.18% at 10⁶** | A wider or narrower truncation moves the bound directly. |
| `canonicalMap` growth | chain **exponent 1.91–2.05**; wide **1.20–1.58**, over six runs | A memoized closure walk would be near-linear on both. |

**The scaling row came out badly, and that is why it belongs.** `canonicalFor` calls
`sourceClosureOf` → `upstreamOf`, an un-memoized DFS, once per node. On a chain the cost is
**quadratic**, so *"cheap by construction at any depth"* was not true as written. A wide, shallow
graph is cheaper but not free — clearly super-linear, well short of quadratic.

This row is the **one non-exact output on this page**: it is fitted from wall-clock, so it is
machine-dependent and moves between runs on the same machine. The ranges above are six runs, quoted
as ranges for that reason — a single decimal here would be a number that does not reproduce, which
is exactly what the rest of this page is careful not to publish. Read the shape (quadratic against
super-linear), not the digits.

**Proving the rows discriminate.** `tests/staleness-corpus.test.ts` runs a **second, correct-looking
engine** — one hashing each node's direct inputs rather than its transitive source closure — through
the same corpus, and requires the soundness row to separate the two. It asserts the converse as
well: swapping the engine must leave ground truth *unchanged*, which is what proves the truth path
never consults the engine. Mutation checks sit alongside as the weaker complement. Both were
verified by mutation: making ground truth read the engine turns four tests red, and making every
derivation information-preserving turns three red and collapses the source-edit row to 0 missed /
0 unnecessary — precision 100%, the exact shape a tautology takes. The price table's denominator is
held the same way: widening it back to every node, sources included, turns its own test red.

## Sampled — `akesi-pil`

### Pre-registration — recorded before the run

[`akesi-pil/README.md`](akesi-pil/README.md) § *When the model gets it wrong* asserts that
accumulating **every** prior rejection beats sending only the latest — *"the model fixed each named
problem and broke a different one"* — from a single six-attempt run. This measures that.

Case set, both strategies, the retry loop and the scorer:
[`akesi-pil/benchmarks/retry-corrections.ts`](akesi-pil/benchmarks/retry-corrections.ts).

- **Strategies.** `accumulate` is the shipped `correctionSuffix`; `replace` passes the same function
  only the most recent rejection. Identical wording, different content — so the comparison isolates
  accumulation and cannot quietly be measuring a reworded prompt. Asserted offline.
- **Cases.** Twelve synthetic patients, no PHI, on lab units a model tends to answer in something
  else (protein in `g/L`, glucose in `mmol/L`, ferritin in `µg/L`). Four also require an imperial
  explanation, so two independent conditions must hold at once — the structure the claim is about.
- **Outcome.** Attempts until the package's own `validate()` passes, censored at 4. **Lower is
  better**, the one place on this page where that is true. Success-within-3 is reported separately,
  because a mean over censored values hides a difference that lives entirely in the failure rate.
- **Test.** Paired across matched cases (cases differ enormously in difficulty), exact two-sided
  sign test over the discordant pairs, Wilson intervals on the rates.

| Regime | Model | n | Purpose | Detectable effect |
|---|---|---|---|---|
| Failure-inducing | `claude-haiku-4-5` | 12 cases × 2 replicates = 24 | resolution on the **strategy** — deliberately the weakest model, so the validators fire | needs **18 of 24** discordant pairs to reach p<0.05, and that is the best case: every tie costs power |
| Production | `claude-sonnet-4-6` | 12 | external validity — what Ranges actually runs on | needs **10 of 12**; too small to detect anything but a large effect, and reported as such |

**What each outcome will mean, decided now rather than after seeing it.** A clear win for
`accumulate` confirms the README. A flat result at these n does **not** refute it — it means the
effect is smaller than this instrument resolves, and that is what will be written. A win for
`replace` would be a genuine surprise and would send the README's paragraph back for revision.

### Result — run 2026-08-30

Every attempt validated on the first try: **72 of 72 draws**, both models, both strategies, **zero
rejections**.

| Regime | Model | Draws | First-attempt valid | Rejections | Discordant pairs |
|---|---|---|---|---|---|
| Failure-inducing | `claude-haiku-4-5` | 48 | 48 | **0** | **0** |
| Production | `claude-sonnet-4-6` | 24 | 24 | **0** | **0** |

That one run answers a question it was not built for and leaves the one it was built for open. The
two are reported separately below, because they point in opposite directions.

#### What it measured: the Ranges prompt is strong

The shipped Ranges prompt produced a response passing the package's own `validate()` on the **first
attempt in 72 of 72 draws**, across two models. Those draws cluster on **12 distinct cases**, so
they are not 72 independent samples — the honest interval is the per-case one, **[0.76, 1.00]** at
12 of 12, not the [0.95, 1.00] that counting every draw as independent would report.

**The validator was confirmed live**, because a run of all-passes is exactly the shape a broken
check produces: re-validating one of these responses against a different expected unit rejects it,
and the offline tests reject a wrong unit and a missing imperial line on the shipped code path. The
72 passes are real passes.

#### What it did not measure: which correction strategy is better

The retry loop never reached attempt 2, so no correction was ever built — and with an empty
rejection list both strategies append the same empty string. The two arms sent **byte-identical
prompts**. This is one strategy sampled twice, not a tie between two.

The regime was chosen to produce failures and did not, for a reason that is the useful part of the
run: **the shipped prompt states both targeted conditions outright**, in the user message, before
the model answers.

```
Unit: g/L
This unit (g/L) has an imperial equivalent (mg/dL); explanationImperial is REQUIRED, not null — at least 20 chars converting every number to mg/dL.
```

A wrong unit and a dropped imperial line are what the retry loop exists for, and this surface closes
both by construction. Reaching for the weakest available model could not change that, because the
difficulty was never in the model. Selecting a regime that produces failures is the third rule at the
top of this page, and this run is where it was not met.

The pre-registration committed to reading a flat result as *"the effect is smaller than this
instrument resolves."* That reading is not available: with zero discordant pairs no split reaches
any α, so the instrument took no measurement rather than a null one. Which surface would resolve the
claim is under *Not yet measured* below.

Cost: 72 calls rather than the budgeted 216, for the same reason the comparison never happened —
nothing retried.

### The seam

`compareBrains` is the only thing demonstrated here that is in neither package's domain, and that is
deliberate: [`ARCHITECTURE.md`](ARCHITECTURE.md) is explicit that neither package imports the other
and that a host is what joins them. The host side is the whole join, and it is this short:

```ts
import { compareBrains } from "@pablotech/neuro-pil/compare";
import { CASES, VERSIONS, runCase, score } from "@pablotech/akesi-pil/benchmarks/retry-corrections";

const anthropic = new Anthropic();
const cases = withReplicates(CASES, replicates);
const result = await compareBrains(cases, VERSIONS, (c, v) => runCase(anthropic, model, c, v), score);
```

`npm run bench:retry` in `akesi-pil` prints the user message and both correction suffixes, and makes
no call — the package constructs no client and reads no key, here as everywhere else.

## Not yet measured

- **What the staleness gate has caught in production.** The corpus above measures the engine on
  generated graphs; it says nothing about how often a real stamp has gone stale on real data, or
  whether the regeneration it forced was worth it. That needs counting instrumented over months, and
  it has not been done. Do not read the deterministic rows as a claim about production.
- **Whether accumulating corrections beats replacing them.** Still open — the run above did not
  measure it. Measuring it needs a regime where the validator actually fires, and the run showed
  where such a regime is *not*: any condition the prompt states outright. The claim originated on
  Finding, whose rejections are structural (a duplicate marker group, a bad requisition group) and
  are not restated in the prompt as a rule the model can simply follow — that is the surface worth
  trying, at roughly $5 per Opus attempt. A cheaper alternative is to keep Ranges and drop the
  conditions the prompt pre-empts, but that measures a prompt this repo does not ship, and the
  result would have to say so.
- **Everything else `akesi-pil` builds.** Prompt surfaces are golden-fixtured — asserted
  byte-for-byte, so a change is reviewable — which is version control, not evidence about output
  quality.
