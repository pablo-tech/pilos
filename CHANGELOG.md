# Changelog

All notable changes to this repo's packages are documented here, by hand, one entry per release —
not generated from commit history. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for why: a release entry
records *why* something shipped, which a commit log can't reconstruct on its own.

## [0.1.0] - 2026-08-29

Initial public release.

- **`neuro-pil`**: a generalized dependency-graph, staleness, and canonical-hashing engine —
  incremental computation over a content-addressed dependency graph, in the lineage of relational
  views (Codd), Make, Bazel, Nix, and self-adjusting computation. Two front-ends (`defineDag`,
  `dagFromFiles`) over one `Dag` type; see [`README.md`](README.md) and
  [`neuro-pil/ARCHITECTURE.md`](neuro-pil/ARCHITECTURE.md).
- **`akesi-pil`**: a worked example of `neuro-pil`'s view pattern applied to one reasoning domain,
  clinical-reasoning prompts over lab/marker data. See [`akesi-pil/README.md`](akesi-pil/README.md).
