# Start here

Two ways in. Pick the one that sounds like you.

- **[A · You don't write code, and you're curious](#a--you-dont-write-code-and-youre-curious)** —
  three minutes, no code.
- **[B · You write code and want to see it work](#b--you-write-code-and-want-to-see-it-work)** —
  ten minutes, you'll run it.

Everything below either points at another document or translates one. Nothing is explained twice:
where this file would have to restate a mechanism, it links instead.

---

## A · You don't write code, and you're curious

### The problem, as a situation you have already had

Someone on your team wrote a one-page summary of a dataset. They have since left. The dataset has
since been corrected.

Is the summary still right?

You cannot check by asking them to write it again — they are gone. Ask someone else and you get a
different page, which tells you nothing about whether the first one was wrong. The only move left is
the modest one: know what they read, and notice when it changes.

Now make that analyst permanent. Send a large language model the same query twice and you get two
different paragraphs, both reasonable. That is not a defect to be fixed; it is what the thing is.

Almost every other number in a company escapes this problem, and it is worth seeing why. A
spreadsheet cell, a compiled program, last night's report — if you doubt one, you run it again and
compare. That single move is the foundation under every cache, every build system and every "refresh"
button ever written. It is not available here. **This repo is what you do instead.**

### What is actually in it

Two small libraries. Neither one is clever, and that is deliberate.

**[`neuro-pil`](neuro-pil/) — the paper trail.** It writes down what each conclusion was based on, and
tells you later when any of it has moved.

> Your lab revises what counts as a normal result for one marker: the ceiling drops from 100 to 70.
> Which of the conclusions already written read that marker against the old number?

It answers that by name — and answers it without reading a single conclusion. It never opens one. Not
needing to is the whole trick, and it is why the same library works over lab results, invoices or
weather stations without being told which it is holding.

**[`akesi-pil`](akesi-pil/) — the receiving inspection.** When you ask a model for a reply under
stated rules, it re-checks every one of those rules in code before the reply is allowed to count.

The interesting part is not replies that arrive malformed. Models can be made to return well-formed
data, and where that is available this package lets them. What is left over is the reply that arrives
perfectly well-formed and is still wrong:

> You asked for one summary per note, and sent five notes. Four summaries come back — all valid, every
> field the right type. Nothing is malformed. And every summary after the gap is now attached to the
> wrong note.

The repo's own way of putting it: a count mismatch is *not a formatting problem* — it means an answer
has been silently attached to the wrong query. Assembling a single finding can fail on 96 distinct
checks of that kind.

The reason both exist is that neither is enough. A well-formed answer can rest on figures that have
since been revised; correct figures can have been read by reasoning that has since been rewritten.
Only the two together tell you a stored answer still stands.

### What it is not

- **Not a mind, not an agent, not "an AI."** Nothing here thinks, decides, or acts. Both libraries
  are bookkeeping — meticulous bookkeeping about where answers came from.
- **It does not make a model smarter.** It changes nothing about the answer you get. It only lets you
  say, afterwards, whether that answer still rests on what it originally rested on.
- **It does not diagnose.** The medical package assembles the query and refuses replies that break
  the rules it stated. It offers no clinical opinion and is not medical advice.
- **It never tells you an answer is wrong** — only that something the answer was based on has since
  changed. Those are different claims, and the smaller one is the one that can actually be proven.
  The repo's own phrasing is *"validity is not reproducibility"*, and the whole design lives inside
  that distinction.

### Seven words, decoded

The rest of the documentation uses these freely.

| Word | In plain English |
|---|---|
| **brain** | One named, numbered unit of reasoning: a query, plus the model that answered it. Small and specific — not a mind. [The real definition](README.md#what-this-is-for). |
| **query** | One formulated inference: what is asked, the context sent with it, and the shape the answer must take. |
| **source** | A fact nobody worked out — raw evidence. A measurement, a price, a reading. |
| **derived** | Something written *from* sources. A summary, a conclusion, a finding. |
| **stale** | Something a conclusion was based on has changed since it was written. Not "wrong" — "worth another look." |
| **stamp** (or *hash*) | A short fingerprint of the evidence behind a conclusion. Same fingerprint, nothing moved; different fingerprint, something did. |
| **schema** | The required shape of an answer, written down strictly enough that a computer can reject one that does not fit. |

### If you want the version written for engineers

[`README.md`](README.md) is the front page, and its first two paragraphs make the same argument as
this section with none of the padding.

---

## B · You write code and want to see it work

### Sixty seconds, from clone to a real result

The graph from the tutorial is already checked in as a test fixture, so there is nothing to create:

```console
$ cd neuro-pil && npm install
$ npx tsx cli.ts lint tests/fixtures/synthetic-vault
neuro-pil: no findings across 3 nodes.
```

Three plain markdown files — two weather stations feeding one weekend forecast — declaring their
edges in YAML frontmatter. Look at the shape of it:

```console
$ npx tsx cli.ts mermaid tests/fixtures/synthetic-vault
graph LR
  forecast/WEEKEND["forecast/WEEKEND"]
  station/COASTAL["station/COASTAL"]
  station/INLAND["station/INLAND"]
  station/INLAND --> forecast/WEEKEND
  station/COASTAL --> forecast/WEEKEND
```

Now break it on purpose. In `tests/fixtures/synthetic-vault/forecast/WEEKEND.md`, repoint one input
at a station that does not exist — `station/COASTAL` → `station/BUOY`:

```console
$ npx tsx cli.ts lint tests/fixtures/synthetic-vault
[unknown-input] forecast/WEEKEND: "forecast/WEEKEND" lists unknown input "station/BUOY"
[orphan] station/COASTAL: "station/COASTAL" (source) is consumed by nothing — collected but never read by anything downstream
                                              # exit 1
```

Two findings from one edit, and the second is the one worth pausing on. `station/COASTAL` is still a
perfectly valid file. Nothing is malformed. It is simply that nothing reads it any more, so evidence
you are still collecting no longer reaches any conclusion — a fact about the *graph*, invisible in
any single file. Put the line back before moving on.

### Then the actual tutorial

[`neuro-pil/README.md` § *Tutorial — a vault from scratch*](neuro-pil/README.md#tutorial--a-vault-from-scratch)
builds that vault from nothing in ten minutes and then does the part this shortcut skips: record a
baseline stamp, and make two edits to show staleness has a direction. Change a station's readings and
the forecast goes stale. Change the forecast's own prose and **nothing** does — it is downstream, not
evidence. If one idea here is worth having in your hands rather than in your head, it is that one.

### Then read, in this order

| Read | Time | For |
|---|---|---|
| [`README.md` § *What this is for*](README.md#what-this-is-for) | 2 min | what a brain is, and the four parts it takes to have one |
| the tutorial above | 10 min | hands on the engine |
| [`ARCHITECTURE.md` § *Building a brain*](ARCHITECTURE.md#building-a-brain) | 5 min | the six steps a host actually performs, and which two are library calls |
| [`neuro-pil/README.md` § *Lineage*](neuro-pil/README.md#lineage) | 10 min | Codd, Make, Vesta, Nix, self-adjusting computation — and where this sits among them |
| [`akesi-pil/README.md` § *When the model gets it wrong*](akesi-pil/README.md#when-the-model-gets-it-wrong) | 5 min | what the discipline costs on a real run, in retries and dollars |
| [`BENCHMARKS.md`](BENCHMARKS.md) | 2 min | what the staleness engine costs you in wasted regenerations, what it saves against regenerating everything, and what the one model run did and did not settle |

Both packages run standalone with no credentials and no network —
[`CONTRIBUTING.md` § *Running a package standalone*](CONTRIBUTING.md#running-a-package-standalone).
A test that needs a secret to pass is a bug in the test.

### The one thing that is not obvious

The instinct on seeing this is that it is a build system, and the right question is why Make, Bazel or
Nix would not simply do it. They are genuinely better at this than the code here — but they are better
because of an assumption that does not hold.

All three fold the *instruction* into the cache key: the recipe, the compiler flags, the derivation.
They can, because the instruction is a function they own and can call again, so folding it in costs
nothing and buys exactness. An LLM call cannot be called again to the same effect. So this engine
hashes sources and **nothing else** — never the derivation, never the node's own text — and thereby
re-inherits the exact blind spot Bernstein diagnosed in Make, where a changed `CFLAGS` marked nothing
stale. That is not an oversight to be patched later. It is the price of working at all against a
derivation you cannot re-run, and it is argued properly in
[`neuro-pil/README.md` § *What this trades away*](neuro-pil/README.md#what-this-trades-away) and
[§ *What this does not catch*](neuro-pil/README.md#what-this-does-not-catch).

The way that blind spot gets bought back is worth seeing too, because it is one move rather than a
subsystem: declare the prompt and the model id as *source nodes* in the graph, and the engine marks
reasoning changes stale by the same mechanism it already uses for evidence, while still knowing
nothing about prompts —
[§ *Declaring the prompt as a source node*](neuro-pil/README.md#declaring-the-prompt-as-a-source-node).
