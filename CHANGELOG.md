# Changelog

All notable changes to this repo's packages are documented here, by hand, one entry per release —
not generated from commit history. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for why: a release entry
records *why* something shipped, which a commit log can't reconstruct on its own.

## [Unreleased]

- **`akesi-pil`**: the benchmark harness moved out and is consumed back as a package.
  `benchmarks/model-portability.ts` and `benchmarks/retry-corrections.ts` had between them a probe
  loop, a censoring rule, a bucket table, a scorer and five statistics functions that are about
  measurement and nothing about lab data; they are now
  [`@promontory-studio/dokimasia`](https://github.com/promontory-studio/dokimasia-rk), declared here
  as an *optional* peer dependency needed only by a `./benchmarks/*` subpath. What stayed is what
  knows what a lab result is: the five probes, the twelve `ranges` cases, the two correction
  strategies, the retry loop and this package's own rejection vocabulary.

  **Breaking, for a host that imported the harness from here.** `Probe`, `ProbeOutcome`, `OnRejected`,
  `censored`, `runProbe`, `runProbeCase`, `budget`, `Budget` and `FeatureScore` are no longer exported
  from `./benchmarks/model-portability`, and `wilson`, `signTest`, `minimumDetectableWins`,
  `successRate` and `withReplicates` are no longer exported from `./benchmarks/retry-corrections`.
  Import them from the harness instead; every one is the same function under the same name.
  `bucketRejection` and `summarize` stay, still bound to this package's buckets, so a host never has
  to supply the table and never scores akesi's rejections against another domain's vocabulary.

  **One behaviour changed with the move.** `summarize` now reports a feature no call was made for as
  **unmeasured** — `passRate`, `firstAttemptPassRate`, `meanAttempts` and `medianMs` are
  `number | null` and are `null` at `n = 0` — where it used to report `0` and `censored(probe)`. Zero
  is reserved for a feature that was asked and failed; the old zeros were being averaged into stack
  scores as if they were measurements. Narrow with the harness's `measured()` guard.
- **`akesi-pil`**: `@anthropic-ai/sdk` is now a devDependency as well as an optional peer. Three files
  here name the type (`model-client.ts` and both benchmark tests) while nothing installed it, so it
  resolved only when some other dependency happened to pull it in — which is not a dependency, it is
  a coincidence. Nothing about what a consumer installs changes: the peer stays optional.
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
