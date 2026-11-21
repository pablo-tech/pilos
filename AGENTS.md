# Finding an answer in this repository

**Where an answer is, as opposed to what this is or how to run it.** Twelve documents hold about
175,800 B here beside this one, and four of them are over 24,000 B — so the expensive mistake is not a slow search
but an unaimed one, which returns a plausible section of the wrong document, and the two packages
make that easy: both carry a `README.md` and an `ARCHITECTURE.md`, so the same word appears in four
documents and means something different in each. [`README.md`](README.md) says what a brain is and
why the repository is two packages, [`START-HERE.md`](START-HERE.md) is the tutorial, and each
package's own `ARCHITECTURE.md` is the contract to implement against; this file says which document
holds a given answer, and restates none of them.

It is also what an agent reads first. The shape is the estate's shared retrieval contract —
`promontory-studio/plover-context`'s `infra/retrieval/CONTRACT.md` — which asks for an entry point
short enough to be read whole, an alias table written by hand, and a generated projection of every
heading beside it.

## Three ways in, in this order

1. **The alias table below**, where the subject is known. It maps the words a question arrives in
   onto the document that answers it, and it is one hop: a row is written only where the document is
   certain, because a missing row is recovered from by the commands below while a wrong row sends a
   question somewhere plausible and empty.

2. **Three ranked commands**, where the table has no row:

   | To find | Command |
   |---|---|
   | the section holding it | `git grep -nE '^#{2,3} .*<word>' -- '*.md'` |
   | the document about it | `git grep -ci <word> -- '*.md' \| sort -t: -k2 -rn \| head` |
   | the file itself | `git ls-files \| grep -i <word>` |

3. **[`HEADINGS.md`](HEADINGS.md)**, where the subject itself is unknown — every `##` and `###`
   heading in the corpus on one page, 118 of them across 13 documents — this file counted, since it
   is in scope like the rest — generated rather than
   maintained. Scan it for the words the question uses, then open the one document.

### The words a question uses

<!-- BEGIN ALIASES -->
| A question saying | Folder or file | Then |
|---|---|---|
| what a brain is, the four parts, identity, a version key, why the model id is hashed | `README.md` | — |
| what this repository is for, in three minutes or in ten, the seven words | `START-HERE.md` | — |
| how a host joins the two packages, the step that crosses between them, building a brain | `ARCHITECTURE.md` | — |
| why neither package imports the other, where the LLM call lives | `ARCHITECTURE.md` | — |
| staleness, what a value was derived from, the tutorial for the engine, the CLI, mermaid, a stamp baseline | `neuro-pil` | `README.md` |
| comparing two versions of a brain, scoring, compareBrains, the manifest front-end | `neuro-pil` | `README.md` |
| what the engine trades away, what it does not catch | `neuro-pil` | `README.md` |
| the node schema, the canonical hashing algorithm, stableStringify, sha256hex12, the source closure, isStamped | `neuro-pil` | `ARCHITECTURE.md` |
| the stamp file, the lint rule catalogue, the diagram format, conformance vectors, porting the engine | `neuro-pil` | `ARCHITECTURE.md` |
| checking what came back, one patient end to end, unit normalization, bucketing by time, the round trip | `akesi-pil` | `README.md` |
| the seven prompts, when the model gets it wrong, the dose rule, the module map | `akesi-pil` | `README.md` |
| the prompt contract, the response contract, a refusal, the two convergence loops, determinism and goldens | `akesi-pil` | `ARCHITECTURE.md` |
| the model seam, swapping the provider, the safety invariants, the host's brain registry | `akesi-pil` | `ARCHITECTURE.md` |
| what this deliberately does not do, out of scope | `neuro-pil` | `ARCHITECTURE.md` |
| a number, what has actually been measured, wasted recomputation, pre-registration, what is not measured yet | `BENCHMARKS.md` | — |
| what a benchmark row has to do to be on the page at all, how the guarantee is lost | `BENCHMARKS.md` | — |
| running one package standalone, regenerating a golden fixture, a move commit, where a pull request goes | `CONTRIBUTING.md` | — |
| the sign-off a contribution arrives under, why there is no CLA, how a release is cut | `CONTRIBUTING.md` | — |
| what changed in a version, which versions exist | `CHANGELOG.md` | — |
| reporting a vulnerability, which versions are supported, what is in security scope | `SECURITY.md` | — |
| conduct, who enforces it, how a report is handled | `CODE_OF_CONDUCT.md` | — |
<!-- END ALIASES -->

### What may be read, and how a hit may be quoted

`.retrieval/config` declares `quote = line`: a matched line may be returned as it stands, not
reduced to its heading. The reason is that a line here is usually the answer — a measured figure in
[`BENCHMARKS.md`](BENCHMARKS.md), a hashing step stated byte-for-byte in
[`neuro-pil/ARCHITECTURE.md`](neuro-pil/ARCHITECTURE.md), a safety invariant in
[`akesi-pil/ARCHITECTURE.md`](akesi-pil/ARCHITECTURE.md) that a reader handed only the enclosing
heading would have to take on trust.

There is no exclusion list, and that is a declaration rather than an omission. This repository is
public, holds no credential and no patient record: every clinical-looking value in it is an invented
example — `akesi-pil/README.md`'s walk-through is one fabricated patient written to show a unit
conversion, and `neuro-pil`'s fixtures are a synthetic weather vault. A line quoted from here
exposes nothing a clone does not already carry.

## Known gaps — what this layer does not route

- **It routes documents, not code.** A question naming a function, a type or an exported symbol is
  answered by `git grep -n '<symbol>' -- '*.ts'`, not from this table. Each package's module map —
  in its own `README.md` — is the closest this layer gets, and it names files rather than symbols.
- **A document at a lowercase path is out of scope until its glob is added.** `.retrieval/config`
  keeps the corpus to root documents and documents sitting directly in a package, which is what
  keeps a synthetic fixture's prose out of the projection; the cost is that an `akesi-pil/docs/`
  added later is invisible to [`HEADINGS.md`](HEADINGS.md) until that file names it. The verifier
  reports it as a stale projection rather than as a silence, which is why this is a cost and not a
  trap.
- **Six markdown files are deliberately unrouted**: `.github/PULL_REQUEST_TEMPLATE.md` and
  `.github/ISSUE_TEMPLATE/bug_report.md`, which are forge forms, and the four under
  `neuro-pil/tests/fixtures/synthetic-vault/`, which are fixture data the test suite builds a graph
  out of and answer no question anybody would ask here.
- **It is not a statement of how work is done here.** The repository's own rules for a change —
  which package owns which test, the sign-off, how a release is cut — are
  [`CONTRIBUTING.md`](CONTRIBUTING.md)'s, and this file points at them rather than holding a second
  copy.
- **`CHANGELOG.md` is generated by the release job**, so it says what moved version by version and
  never why. The argument behind a change is in the pull request and, where it outlived the change,
  in one of the documents above.
