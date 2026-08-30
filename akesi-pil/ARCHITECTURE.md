# `akesi-pil` architecture

This is the contract, not a tour — see [`README.md`](./README.md) for the narrative walk through one
patient. What follows is what a reader needs in order to adapt the package, port it, or judge whether
a change to it is safe: how the modules are layered, what a prompt is guaranteed to be, what a
response must survive before it is believed, where the two convergence loops stop, and how far the
coupling to a model provider actually goes.

The subject of the whole package is one reasoning unit — a clinical **finding** over lab and marker
data. Everything here exists to build the request for one, or to decide whether what came back may be
called one.

## 1. This package's role: derive, don't decide

Almost every export in `akesi-pil` is a pure function or a static table: given source data (a
normalized marker, a reference range, a treatment entry, a document), produce a derived shape (a
prompt, a bucketed treatment, an assembled finding).

The package **does** issue model calls — in exactly three places (§6) — but it never *decides* to.
It constructs no client, reads no key, opens no connection of its own, and stores nothing: the client
is a parameter, supplied by whoever already has one. Nothing here holds state or persists between
calls. That is what makes the package importable from a browser bundle, a Cloudflare Pages Function,
or a plain Node CLI without adaptation — see [`README.md`](./README.md)'s *Importing* section for the
one runtime-specific exception (`./pdf-node`) and why there is no barrel export.

Three decisions are deliberately absent, and all three are the host's: **when** a finding regenerates,
**which** prompt version it regenerates under, and **what** gets recorded about the fact that it did.
Those are described in §8 as a pattern rather than as code, because the reference implementation's
registry lives in a private, product-specific app and is not part of this package.

## 2. The layering

Twenty-nine modules sit at one flat directory level, but they are not flat in dependency terms.
Twenty-seven of them (all but `types.ts` and `index.ts`, which every tier may use) fall into five
tiers, and **imports point downward only** — verified, not asserted: no module imports from a tier
above its own.

| Tier | Modules | Role |
|---|---|---|
| 5 — orchestration | `finding-generate`, `ingest-core` | The only tier that runs a loop: prompt → model → validate → correct |
| 4 — response validation | `finding-assemble`, `finding-regroup`, `report-merge` | Decides whether what came back may be believed |
| 3 — prompt construction | `ranges-prompt`, `marker-groups-prompt`, `report-extract`, `document-read`, `treatment-infer`, `document-model`, `report-title`, `parsers-report`, `factors-edit`, `pinned-queries` | Turns normalized data into request text and schemas |
| 2 — registries | `item-registry`, `system-groups`, `imaging-catalog`, `section-labels` | Static tables mapping raw report vocabulary onto prompt/UI labels |
| 1 — normalization | `unit-systems`, `dates`, `ranges`, `marker-deltas`, `treatment-normalize`, `treatment-bucket`, `treatment-product`, `treatment-timing-rules` | Raw values into a comparable, unit-consistent shape |

Two consequences worth naming, because they are the reason for the shape rather than side effects of
it:

- **Tier 5 is the whole of the package's control flow.** Tiers 1–4 are functions that return values.
  If you are looking for what could loop, retry, or cost money, there are two files to read.
- **Validation does not import prompt construction.** `finding-assemble` has no idea what the prompt
  said. It re-derives every constraint from the source data and the response alone, which is what
  makes it a check rather than a restatement — a validator that read the prompt could only confirm the
  model had been asked nicely.

`finding-generate` holds both a pure builder (`SYSTEM_PROMPT`, `buildUserMessage`) and the retry
orchestrator that drives it, which is why it sits in tier 5 and imports the tier-4 validator it calls.

## 3. The prompt contract

There are **seven** schema-constrained prompt surfaces. A reader who takes the README's end-to-end
walk as the whole package will undercount by six.

| Surface | Builder | What constrains the answer | Golden |
|---|---|---|---|
| Finding | `finding-generate.ts` — `SYSTEM_PROMPT`, `buildUserMessage` | Prose-specified strict JSON (`:490`), enforced entirely in code (§4) | 5 files |
| Marker grouping | `marker-groups-prompt.ts` — `SYSTEM_PROMPT`, `contextBlock` | `GROUPS_SCHEMA` + `reconcileGroups` | 1 file |
| Reference ranges | `ranges-prompt.ts` — `systemPromptFor` | `RANGE_SCHEMA` | 4 files |
| Report extraction | `report-extract.ts` — `systemPromptFor` | `REPORT_SCHEMA` | 4 files |
| Document read | `document-read.ts` | `DOCUMENT_READ_SCHEMA`, via `readDocumentAsJson` | — |
| Treatment inference | `treatment-infer.ts` | `TREATMENT_INFER_SCHEMA`, via `output_config` | — |
| Treatment regrouping | `finding-regroup.ts` — `REGROUP_SYSTEM_PROMPT`, `regroupUserPrompt` | `TREATMENT_GROUPS_TOOL` + `validateRegroup` | — |

The asymmetry in the first row is the important one. The largest surface — the finding itself — is the
only one with **no** schema constant and no `output_config`; it asks for strict JSON in prose. It is
also, not coincidentally, the surface with 96 distinct code-level refusals behind it. Structured
output constrains shape; it cannot constrain whether a group name was invented, whether a note was
answered in the right order, or whether a dose was carried over correctly. Where the constraint is
semantic, it has to be code.

Three surfaces have no golden fixture: `document-read`, `treatment-infer` and `finding-regroup`. That
is a real coverage gap, stated rather than papered over — the four covered surfaces are the ones whose
text is patient-derived and therefore most likely to drift silently.

### Determinism, and what actually makes goldens possible

The obvious claim — *prompt builders take `today` as a parameter, so they are pure* — is only half
true here, and the half that is false is the load-bearing one. Some builders do take the date
(`treatment-bucket.ts:38,124`, `report-extract.ts:164,271`). But `buildUserMessage` reads the clock
**directly**, in four places: patient age, the recent/prior marker split, the six-month overdue tag,
and the literal `Today:` line. `ranges-prompt` reads it in two more.

Determinism therefore comes from the harness, not from the signatures.
`tests/gen-prompt-golden.ts` freezes `Date` at `2026-06-28T12:00:00Z` by substituting a subclass for
the duration of generation, and `vitest.config.ts` pins `TZ=UTC`. Both are required: a frozen instant
with a local timezone still moves the date across a midnight boundary.

The mechanism that keeps this honest is that `withFrozenClock` and `FROZEN_NOW` are **owned by the
generator and imported by the test**, so the two cannot disagree about what "now" is. Without that,
regenerating a fixture and asserting it would be the same statement made twice.

The fixture suite guards its own maintenance, which matters more than its coverage:

- The directory is asserted non-empty first, so a wiped fixture set fails loudly instead of making
  every later assertion vacuous.
- Every file on disk must still be produced by the generator, so a prompt variant deleted from the
  code cannot leave an orphan sitting there asserted against nothing.
- `npm run prompt:golden` regenerates **all** files at once, so a deliberate prompt change is one
  reviewable diff rather than a hand-edit of the file that went red.
- A **separate set of assertions**, independent of the byte comparison, checks that the finding
  system prompt still says the things it must not stop saying — that it is decision support and not a
  diagnosis, that it frames suggestions for the patient's physician, that it refuses to invent data.
  A byte-for-byte fixture makes the *removal* of a safety clause one quiet line in a large regenerated
  diff; these make it a red build.
- No fixture may contain a pilot user's name. Every fixture is synthetic and this package is
  published; that guard makes a PHI leak into an open-source artefact a red build rather than a matter
  of remembering.

## 4. The response contract

What a model returns is a claim, not a result. `finding-assemble.ts` refuses it on four distinct
grounds, and the taxonomy is the substance of this package:

**Schema-level** — shape. Missing fields, wrong types, unparseable JSON. Where a surface uses
`output_config` this is largely the provider's job; for the finding surface it is
`finding-assemble`'s.

**Name-level** — a name the model was told to reproduce verbatim, and did not. Disease-group names are
checked in **six** separate places (`finding-assemble.ts:222,243,278,403,473,523` — study results,
note results, treatments, treatment groups, definitions, data requisitions), because a group name can
enter the response through six different fields and an invented one is a mis-filing of clinical
content under a heading that does not exist. `reconcileGroups` applies the same rule on the grouping
surface: any group name not taken verbatim from the allowed systems is **dropped**, not corrected.

There is one deliberate exception, and it is a repair rather than a refusal. On `doctorConversation`
labels only (`:347-365`), where the returned label is a prefix of the expected one *or the reverse*,
it is treated as a truncation of a long label the model was asked to reproduce verbatim, and the
canonical spelling is stamped over it so downstream readers see one form. Anything else still throws.
The rationale is a price: a run died on attempt 6 because the model dropped a trailing
`± cofactors` from an intervention name it had itself written, and a $5 regeneration is an absurd
cost for a transcription slip. A prefix relationship is the signature of a truncation; naming an
*unrelated* intervention — the actual misattribution risk — is not prefix-shaped and is untouched by
this.

**Count-level** — positional zip. `noteResults` must have exactly one entry per populated note, in
order (`:230-232`); `doctorConversation` must have one entry per disease group, one per patient
decision and one per AI consideration, in that order (`:327-330`, with a positional group-order check
at `:339-365`). This kind is the least obvious and the most necessary: a note has no short label to
echo, so there is nothing to match on except position. A count mismatch is therefore not a formatting
problem — it means an answer has been silently attached to the wrong query.

**Bound-level** — domain sanity. At least four disease areas (`:247`); at most thirty treatments
(`:264`). These catch the failure where a response is well-formed, correctly named, correctly counted,
and still obviously not a finding.

Over both direct and positional paths, `finding-assemble.ts` raises 96 distinct validation failures.
`reconcileGroups` additionally guarantees **exactly-once coverage**: every marker appears in exactly
one group, duplicates are dropped on first placement, and anything left unplaced lands in an explicit
`UNCATEGORIZED` bucket rather than vanishing. Silent loss is the failure mode it exists to prevent —
a marker that disappears from a grouping is invisible in the output, whereas one in `UNCATEGORIZED` is
a visible defect.

## 5. The convergence contracts

Two loops re-prompt on failure. Both are bounded, and in both cases the bound is a measured number
rather than a round one.

### Marker grouping — `runMarkerGroupingPasses`

One full pass over every marker, then **at most three** re-passes over only the still-unplaced
residue. Placements accumulate across passes and first placement wins, so a later pass can add but
never contradict.

Two stop conditions, not one: the residue reaching zero, and a pass placing nothing new. The second is
a fixed-point break — a model that failed to place a marker twice will keep failing, and the third
attempt costs the same as the first.

The escape hatch is removed on retry. The first pass may answer `UNCATEGORIZED`; a re-pass is told
explicitly that it is not permitted in this response, and the context is narrowed to the residue
alone. The bucket still exists — but as a safety net inside `reconcileGroups`, reached by the code, no
longer offered to the model as an option. An escape hatch left available becomes the answer.

### Finding generation — `generateFindingResponse`

**At most three attempts** (`finding-generate.ts:1418-1423`). The ceiling is cost-derived, not
aesthetic: each attempt is a whole Opus generation — roughly $5 and several minutes — and the run that
motivated the current design burned six of them for nothing.

Every prior rejection is accumulated into the correction, not just the latest
(`correctionSuffix`, `:1326`; rationale at `:1372-1377`). That same six-attempt run is why: attempt 4
failed on a duplicate marker group, 5 on a bad data-requisition group, 6 on a `doctorConversation`
label. Each correction named exactly one problem, the model fixed exactly that problem and broke a
different one, and it never once saw the accumulated list. A correction that replaces its predecessor
teaches the model to oscillate.

`onAttemptFailed` is an optional callback invoked with each rejection reason, and it exists for two
reasons that are worth stating together. A silent retry is indistinguishable from a hang — a live
check once ran 32 minutes with no indication anything was happening. And the rejection message can
name a treatment or a study, so it is PHI-adjacent: the package reports it **to the caller** and takes
no view on whether it may be logged, displayed, or dropped.

## 6. The model seam

Five modules `import type Anthropic from "@anthropic-ai/sdk"` — `document-model`, `document-read`,
`report-extract`, `treatment-infer`, `finding-generate`. Every one is a **type-only** import: it
vanishes at compile time, and no consumer needs the SDK at runtime unless it calls one of the three
functions below. The SDK is an optional peer dependency for exactly that reason.

Three call sites issue a request, in two shapes:

| Site | Shape | Why |
|---|---|---|
| `document-model.ts:72` | `messages.create` with `output_config: { format: { type: "json_schema", schema } }`, system block marked `cache_control: { type: "ephemeral" }` | Schema-constrained document read; the system prompt is identical across every document, so it is the part worth caching |
| `treatment-infer.ts:168` | `messages.create` with `output_config` | Schema-constrained, single-shot |
| `finding-generate.ts:1381` | `messages.stream({...}).finalMessage()`, system block cached the same way | A finding runs for minutes; streaming keeps the connection alive and lets a host show progress |

The client always arrives from the caller — positionally for `inferTreatment` and
`generateFindingResponse`, as the `anthropic` field of the call object for `readDocumentAsJson`. There
is no construction, no key read, no base URL, no retry policy of the package's own.

**How far the coupling actually goes.** "No provider dependency" would be too strong a claim, and this
document does not make it. Three request shapes are vendor-specific — `output_config.format.json_schema`,
`cache_control: { type: "ephemeral" }`, and `thinking: { type: "adaptive" }` for Opus models
(`finding-generate.ts:1358-1360`). Porting to another provider means rewriting those three call sites;
it does not mean touching tiers 1–4, which are the overwhelming majority of the package and know
nothing about any provider.

`findingRequestParams` returns the whole parameter object rather than the inner thinking config,
deliberately: the request body is loosely typed, so handing a caller the inner object invites it to
spread that instead, which type-checks and silently turns adaptive thinking off.

**Thrown-message prefixes are load-bearing.** `document-model.ts:7-9` records that a host matches on
them to distinguish "the model produced something unusable" (a 422 to the client) from a transport
failure (a retry). Changing the wording of those messages is an API change, not a copy edit.

**Why `CallModel` exists for grouping and nowhere else.** `marker-groups-prompt.ts:166` defines
`type CallModel = (markers: string[], leftover: boolean) => Promise<{group, markers}[]>`, and
`runMarkerGroupingPasses` takes it as a parameter rather than taking a client. The grouping loop is the
one place with two live callers whose transports genuinely differ — the Node SDK and a Workers-bound
key — so the seam is drawn at the narrowest thing both can satisfy. Elsewhere a single injected client
is sufficient, and inventing an interface per call site would be abstraction bought with no buyer.

## 7. Safety invariants

Each of these is enforced in code. The failure-mode column is why the enforcement is not merely a
preference.

| Invariant | Enforced at | If removed |
|---|---|---|
| **Clinical safety: convert only verified analytes.** A unit conversion is applied only where a factor has been explicitly verified; anything else is passed through unconverted | `unit-systems.ts:12` and the conversion table | A plausible-looking wrong factor silently rescales a marker, and the error survives every downstream check because the value is well-formed |
| **The dose rule.** The most heavily weighted instruction on the treatment-inference surface | `treatment-infer.ts:121` | A dose inferred rather than read is the highest-consequence error this package can make |
| **Treatment fencing by time.** `bucketOf` classifies past/ongoing/planned from explicit start/end dates against a supplied `today` | `treatment-bucket.ts:38` | A discontinued treatment is reasoned about as current |
| **Verbatim group names.** Non-verbatim names dropped on grouping, refused in six places on assembly | `marker-groups-prompt.ts:152`, `finding-assemble.ts:222,243,278,403,473,523` | Clinical content is filed under a heading that does not exist, and is invisible in every view organized by group |
| **Exactly-once marker coverage.** Every marker in exactly one group, residue explicitly bucketed | `reconcileGroups` | A marker disappears silently; an omission is undetectable where a mis-grouping is visible |
| **No real patient name in a fixture.** Asserted over every golden file | `tests/prompt-golden.test.ts` | PHI reaches a published open-source artefact |

## 8. The host's job: a brain registry

A host embeds `akesi-pil` as one or more `derived` nodes in a [`neuro-pil`](../neuro-pil) `Dag` (see
[`../neuro-pil/ARCHITECTURE.md`](../neuro-pil/ARCHITECTURE.md) §1 *Node/vault schema* and §2
*Canonical hashing algorithm*). The
node's `inputs` are the source markers, ranges, and prompt-template text a given finding depends on;
`canonicalFor`/`driftedKeys` then tell the host exactly which findings a source edit invalidates —
`akesi-pil` itself never needs to know.

On top of that staleness signal, a typical host layers three things this package intentionally
doesn't:

- **A brain registry** — a table mapping each finding kind to the current prompt-construction
  version (which function from this package to call, with which parameters). Bumping an entry is how
  a host ships a prompt change without touching every existing finding at once: `driftedKeys` marks
  what's stale under the *new* version, and regeneration is opt-in per finding rather than a mass
  rewrite. A recorded version must never be *defaulted* to the current one when it is absent — a
  missing entry means genuinely unknown, and guessing it corrupts precisely the join the event log
  exists to make (`types.ts:515-518`).
- **An event log** — an append-only record of what actually regenerated, when, under which version,
  and why (a source edit, a manual trigger, a version bump). This is what makes "why does this
  finding look different from last week" answerable after the fact; `akesi-pil`'s functions are pure
  and stateless, so nothing here can log its own invocation.
- **A comparison harness** for scoring competing versions before promoting one — see
  [`../neuro-pil/compare.ts`](../neuro-pil/compare.ts)'s `compareBrains`: run each candidate version
  against a fixed case set, score each result, and compare means. `run` and `score` are the entire
  extension surface, so a host wires `compareBrains` to whichever model call and scoring rubric it
  uses without this package or `neuro-pil` ever depending on a model provider.

The three are not three conveniences; they are what it takes to own one **brain** over time — a named
`{prompt, model, schema, audience}` unit, which the registry versions, the log records every run of,
and the harness replaces only on evidence. The version key must hash the model id along with the
prompt text: the same prompt on a different model is a different brain, so a key that ignores the
model starts lying at the next upgrade. The repo README
[defines the term](../README.md#what-this-is-for), and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md#building-a-brain) sets out the assembly in six steps.

None of the three is prescribed further here — the registry's shape, the log's storage, and the
scoring rubric are all host decisions this package deliberately stays agnostic to.

## 9. Explicitly out of scope

- **Which model a host calls, and with what credentials.** The client is a parameter (§6); the
  provider-shaped surface is three call sites and is documented rather than abstracted away.
- **When to regenerate.** That is the staleness signal's job, and acting on it is the host's (§8).
- **Storage, sync, or encryption of source data.** This package operates on already-loaded structured
  data. It persists nothing.
- **UI rendering** of a finding once assembled.
- **Clinical judgement.** Every refusal in §4 is structural — coverage, naming, ordering, bounds. That
  a response is well-formed, correctly named and correctly counted says nothing about whether its
  reasoning is right, and nothing in this package claims otherwise.
