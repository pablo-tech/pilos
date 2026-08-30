# pilos

[![CI](https://github.com/pablo-tech/pilos/actions/workflows/ci.yml/badge.svg)](https://github.com/pablo-tech/pilos/actions/workflows/ci.yml)

*πῖλος — felt: cloth with no warp and no weft, holding together only by how the fibres catch on one
another. Both packages here carry the root. More on that, and on νεῦρον and Ἀκεσώ,
[below](#on-the-names).*

An LLM call cannot be checked by running it again. The same prompt and the same model return
different words, so the question every cache, build system and memoizer answers by re-deriving —
*is this derived value still good?* — has no answer here. The usual substitutes are a TTL, a
"regenerate" button someone has to remember to click, or a comment that says *rerun this if X
changes*.

> **New here?** [`START-HERE.md`](START-HERE.md) has two short ways in — three minutes with no
> code, or ten minutes running it.

## What this is for

A derivation you cannot re-run is one you cannot safely own. The question — *is this derived
value still good?* — takes three forms in practice: Is it still current? What changed it? Is the
new version better than the one it replaced? All three presuppose a unit you can point at, name and
version — and an LLM call, left as a call, is not one.

This repo is the parts of that unit.

> A **brain** is the smallest unit of reasoning you can name, version, mark stale and score: a prompt, a
> model, a response schema, and the audience it is written for — identified by a hash of its own text,
> the model id included. It is not a mind, not an agent, and not a model. It is the thing you have to
> be able to point at before the question can be asked at all.

Owning one takes four parts, and no more than four:

| Part | What it is | Where it comes from |
|---|---|---|
| **Identity** | a name, looked up at the point a reasoning step runs | the host |
| **Version** | a content hash of the prompt, the schema, and the model id | the host |
| **Enforcement** | every constraint stated in prose, re-checked in code on the response | `akesi-pil` |
| **Evidence** | what it was derived from, and whether that has moved since | `neuro-pil` |

The model id is not decoration. The same prompt on a different model is a different brain, so a
version key that hashes only prompt text starts lying the moment the model is upgraded.

The audience is not a separate thing to hash. It is written into the prompt — *for a patient with no
medical training*, *for a treating clinician* — so the prompt hash already carries it. Retargeting a
brain at a different reader means editing the prompt, which is exactly when the version should move.

Two of the four are packaged here, one each:

- **Check the output when it arrives.** A prompt is a request, not a guarantee, so every constraint
  stated to the model in prose is stated again in code and enforced on the response — including the
  ones no schema can state, like *this heading must be one the patient actually has* —
  [`akesi-pil`](akesi-pil/).
- **Track what the output was derived from.** A value is stale when something it was derived from has
  changed since. Record that evidence, and a revised reference range marks every finding that read it
  and nothing else: staleness stops being something anyone has to remember —
  [`neuro-pil`](neuro-pil/).

Neither is sufficient alone, and that is the argument for shipping both. An enforced response says
nothing about whether the evidence under it has moved; a fresh evidence stamp says nothing about
whether the reasoning that read it was the same reasoning. Only together do they say whether a stored
answer still holds.

They are siblings, not a library and its demo. **Neither package imports the other**, there is no
shared `common/`, and a host application is what joins them into one brain. How to actually assemble
the four parts — declare, version, stamp, enforce, score, log — is set out in
[`ARCHITECTURE.md`](ARCHITECTURE.md#building-a-brain).

## Checking what came back — `akesi-pil`

Nothing about a response is guaranteed by having asked. `akesi-pil` handles that half on one real
workload: clinical reasoning over lab and marker data.

The discipline is one rule. **Every constraint stated to the model in prose is stated again in code
and enforced on the response.** Grouping markers by body system is the clearest case:

- The prompt names the allowed systems and requires them verbatim; the response is constrained to a
  JSON schema.
- `reconcileGroups` then drops any group name that is not one of those systems, sweeps its markers,
  dedupes, and guarantees every marker is placed exactly once — so an invented or renamed group
  cannot reach the output whatever came back.
- `runMarkerGroupingPasses` re-prompts only the markers still unplaced, at most three times, and
  stops early when a pass places nothing new. The first pass offers the model an "uncategorized"
  escape hatch; the re-prompt takes it away.

The same rule holds outside grouping. Assembling a finding refuses — in every place a group name
can enter — a response whose chosen group is not one of the disease groups the model was given,
rather than storing it.

And because the prompt *is* the derivation, prompts are version-controlled like code:

- **Golden files** hold the prompts this package builds, asserted byte-for-byte with the clock and
  timezone pinned — so a prompt change is one reviewable diff, and the fixture never reddens by
  itself.
- A **separate set of assertions** checks the clinical-safety clauses are still present at all, so
  removing one fails loudly instead of passing as a quiet line in a large regenerated diff.
- `compareBrains` runs candidate [brains](#what-this-is-for) against a fixed case set and scores
  them, so a version is promoted on evidence rather than on a hunch — [one real run, and why it
  settled nothing](BENCHMARKS.md#sampled--akesi-pil).

The package does issue the model call, but it never *owns* it: the client is a parameter, the SDK
import is type-only, and nothing here constructs a client or reads a key. So the tests need no
network, and the provider-shaped surface is small enough to name — three call sites, documented in
[`akesi-pil/ARCHITECTURE.md`](akesi-pil/ARCHITECTURE.md) § *The model seam* rather than hidden behind
an abstraction that would claim more independence than there is.

The walk through one patient, end to end, is in [`akesi-pil/README.md`](akesi-pil/README.md).

## Tracking what it came from — `neuro-pil`

Declare a graph — sources, and the derived nodes built from them — and ask for the canonical string
of any node: a deterministic serialization of exactly the source values that node transitively
depends on. Record it when you produce the node. Compare it later. Different means stale; identical
means still valid. What actually produces a node — the model call, the build rule, the report — never
has to be understood, trusted, or run by the graph itself.

| Function | What it does |
| --- | --- |
| `defineDag(nodes)` | Builds a `Dag` from a flat list of nodes. |
| `dagFromFiles(files)` | Builds the same `Dag` from a map of file path to raw file text. |
| `validate(dag)` | Reports structural problems in the graph shape alone: duplicate keys, unknown inputs, sources with inputs, cycles, orphaned sources. |
| `renderMermaid(dag)` | Renders the graph as a Mermaid `graph LR` string. |
| `canonicalFor(dag, subject, slices, key)` | The **stamp** for one node: a deterministic, sorted-key JSON string of the source values that node transitively depends on. |
| `driftedKeys(now, stamped)` | The **stale keys**: every key whose stamp differs from the recorded one, or is missing from it. |

The trade it makes is deliberate, and it is the reason this repo exists rather than a concession:
`neuro-pil` hashes only *source* values, never the derivation. That is a subtraction from Vesta,
Bazel and Nix, and it lands on precisely the blind spot Bernstein diagnosed in Make — a changed
prompt marks nothing stale, exactly as a changed `CFLAGS` marked nothing stale. Every one of those
ancestors can fold the instruction into the key because the instruction is a function it owns and
can *call again*. An LLM call is not. Put plainly: **`neuro-pil` is Nix's closure hash with Make's
blind spot, and the blind spot is deliberate.**

**Validity is not reproducibility.** That is the entire claim. It never asserts that regenerating a
node yields the same bytes — only that the evidence it was derived from has not moved.

The fifty-year lineage that argument sits in — Codd, Make, Vesta, Nix, self-adjusting computation,
Adapton/Salsa and *Build Systems à la Carte* — is in
[`neuro-pil/README.md`](neuro-pil/README.md#lineage), along with a worked example and what the
approach [does not catch](neuro-pil/README.md#what-this-does-not-catch).
[`neuro-pil/ARCHITECTURE.md`](neuro-pil/ARCHITECTURE.md) specifies the byte-level contract precisely
enough for an independent, non-TypeScript implementation to match it.

## What has actually been measured

The two packages make different kinds of claim, so they can carry different kinds of evidence, and
this repo keeps them apart rather than reporting one number for both.

`neuro-pil`'s claims are about a pure function over a graph, so they can be settled exactly: a
seeded corpus of 200 generated DAGs in which every derived node computes a real value, checked
against ground truth taken by evaluating those values rather than by walking the graph the engine
walks. Offline, free, reproducible from the seed. That includes the claims that go against it: the
engine never misses a change, and it pays for that by regenerating **436 of 1001** nodes that would
have come back identical — a bill you would otherwise pay six times over by regenerating everything.

`akesi-pil`'s claims are about how a model behaves under a prompt, so the best available evidence is
a mean over a case set at one model on one day. The one such run this repo has done says the shipped
Ranges prompt is strong — **72 of 72** first attempts passed validation — and leaves the claim it
was built to test, whether accumulating corrections beats replacing them, exactly where it was:
nothing was ever rejected, so there was nothing to correct.

Every number lives in [`BENCHMARKS.md`](BENCHMARKS.md), including a list of what has **not** been
measured — most importantly, what the staleness gate has caught in production, which the corpus says
nothing about.

## On the names

**Felt** (πῖλος, *pilos*) is a non-woven cloth: no warp, no weft, no plan — the structure is entirely
in how the fibres interlock. It is the shared root of both package names, and the reason it is the
repo's name is that it is what the two halves have in common. Neither package models the things at
the ends; both model the connection between them.

It is also the honest shape of a brain as this repo means one. There is no loom on which a prompt, a
model, a schema and a hash are laid out in advance; a brain holds because its parts catch on one
another — the schema catches what the prompt asked for, the version hash catches which model
answered, the stamp catches what the evidence said at the time. Each `-pil` is one fibre.

**Neuropil** is the dense, tangled mesh between nerve cell bodies — unmyelinated axons, dendrites and
glial processes — and it is where most synaptic connection actually happens; in the mouse it is some
84% of cortical grey matter. Greek νεῦρον, *sinew* or *cord*, plus πῖλος: literally **nerve felt**,
for how it looks under a microscope. It is the connections, not the cell bodies, that do the
computing — which is that package's entire design position. It never runs, understands or trusts the
derivation at either end of an edge.

**Akeso** (Ἀκεσώ) is the Greek goddess of healing, daughter of Asclepius — and specifically of the
*process* of curing rather than the cure itself, which was her sister Panacea's. `akesi-pil` builds
the reasoning and checks what comes back. It does not diagnose, and says so.

## Packages

Two, not one — kept separate so the engine has no dependency on the domain that motivated it:

- [`neuro-pil/`](neuro-pil/) — the engine: `Dag`, both front-ends, canonical hashing, the CLI.
  Nothing in it is clinical, and nothing in it knows what a prompt is; a graph over weather
  stations, invoices or build artifacts is as valid a consumer.
- [`akesi-pil/`](akesi-pil/) — the domain package `neuro-pil` was extracted alongside:
  schema-constrained clinical-reasoning prompts over lab and marker data, whose every stated
  constraint is re-enforced in code on the response, under byte-for-byte regression. It is the
  workload that motivated the engine, not a demonstration of its API.

A third would have to earn the root the way these two do: by being a **part of the construction** —
something a brain needs in order to be named, versioned, marked stale or scored — rather than a utility
that happens to live nearby. Two exist, and two is the whole list.

## License

MIT — see [LICENSE](LICENSE).
