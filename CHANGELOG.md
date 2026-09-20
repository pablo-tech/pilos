# Changelog

All notable changes to this repo's packages are documented here, by hand, one entry per release —
not generated from commit history. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for why: a release entry
records *why* something shipped, which a commit log can't reconstruct on its own.

## [Unreleased]

- **`akesi-pil`**: `DocumentSource` gains a `{ pageImages }` form, so a document can be read by a
  vision model that accepts images but not a PDF file part — which is most OpenAI-compatible
  endpoints. The package still renders nothing; the caller supplies the rendered pages.
- **`akesi-pil`**: `benchmarks/model-portability.ts`, a general feature × model harness scored by
  this package's own validators, so "which model can run this" is answered by measurement rather
  than by assertion. Additive and host-driven: it makes no calls and ships no case set beyond the
  twelve `ranges` cases it shares with `benchmarks/retry-corrections.ts`.
- **`akesi-pil`**: `bucketRejection` gains a `refused` bucket for a provider answering about the
  account rather than the request — no credit, no key, over the rate limit. A real baseline run came
  back with "your credit balance is too low" and the harness scored it as twelve quality failures;
  on a published table that is indistinguishable from a model answering badly.

## [0.1.0] - 2026-08-29

Initial public release.

- **`neuro-pil`**: a generalized dependency-graph, staleness, and canonical-hashing engine —
  incremental computation over a content-addressed dependency graph, in the lineage of relational
  views (Codd), Make, Bazel, Nix, and self-adjusting computation. Two front-ends (`defineDag`,
  `dagFromFiles`) over one `Dag` type; see [`README.md`](README.md) and
  [`neuro-pil/ARCHITECTURE.md`](neuro-pil/ARCHITECTURE.md).
- **`akesi-pil`**: a worked example of `neuro-pil`'s view pattern applied to one reasoning domain,
  clinical-reasoning prompts over lab/marker data. See [`akesi-pil/README.md`](akesi-pil/README.md).
