# Contributing

## Running a package standalone

Each package under this repo (`neuro-pil/`, `akesi-pil/`) runs with zero credentials and zero
network access:

```
cd neuro-pil && npm install && npm test
cd akesi-pil && npm install && npm test
```

**The test suites need no network and no credentials.** `neuro-pil` never contacts anything at all.
`akesi-pil` does issue model calls, in three places — but it constructs no client and reads no key:
the client arrives as a parameter, and the SDK import is type-only, so nothing is reachable from a
test that doesn't pass one in (see its
[`ARCHITECTURE.md`](akesi-pil/ARCHITECTURE.md) §1 *This package's role: derive, don't decide* and §6
*The model seam*). If a test needs network access or a secret to pass, that's a bug in the test, not
a missing setup step.

## Benchmarks

Two kinds, and they are run differently.

**Deterministic** (`neuro-pil/benchmarks/`) need nothing — no key, no network — so their exact
properties are asserted in `npm test` like any other test, and `npm run bench` prints the full table.
The suite also reconciles [`BENCHMARKS.md`](BENCHMARKS.md) cell-for-cell against a live run at the
published seed, so a figure on the page cannot drift from the run that produced it. **No rate is
gated on a threshold** — that would turn an honest measurement into something to be managed, and
several of these rates are *expected* to move when the code does. Reconciled is not the same as
gated: the check asks whether the page matches the run, never whether the run is good enough.

**Sampled** (`akesi-pil/benchmarks/`) issue real model calls, so they are opt-in and never part of
`npm test`. This is not an exception to *Running a package standalone* above: the benchmark modules
construct no client and read no key either. The case set, the strategies and the scorer are data,
tested offline against scripted responses; a host supplies the SDK instance and the comparison loop.

Add a measured number to [`BENCHMARKS.md`](BENCHMARKS.md) and nowhere else, with the date, `n`, and
the model it came from. A result that came back flat or negative goes in unchanged — a ledger that
only records wins is not evidence of anything.

Four rules apply to anything added there, and they are what the page is worth:

- **A row measures the claim it is filed under, in that claim's own units.** A number that is easy
  to compute is not a substitute for the one the sentence actually makes. If the claim is about
  output changing, the row has to compute outputs.
- **A row must be able to come out differently for an implementation that is correct but
  different** — and name what that implementation would score. This is stricter than mutation
  testing: breaking the code and watching a number move proves the row *reads* the code, not that it
  *discriminates*. A row with no such answer is a tautology, and a tautology that reports 100% is
  worse than no row at all.
- **Pre-register a sampled run before paying for it.** The `n`, the regime and the minimum
  detectable effect go in first; then the result is reported against them. Deciding what would have
  counted as an effect *after* seeing the numbers is how a benchmark becomes decoration.
- **Publish the interpretation next to the number.** A rate with no stated meaning gets read as
  whichever meaning flatters the author, and the same figure carries opposite meanings in adjacent
  rows: reporting nothing is correct behaviour when a slice normalized the edit away and a silent
  failure when the slice is missing. Say what the number is measured against and what it costs the
  reader — one sentence, in the domain's nouns, separate from the measurement itself.

## Golden-fixture regeneration

`akesi-pil`'s prompt-construction tests assert against golden fixtures rather than re-deriving
expected output inline, so a prompt-construction change is visible as a fixture diff instead of a
silent pass. After changing anything that affects prompt text:

```
cd akesi-pil && npm run prompt:golden
```

Review the diff before committing — a golden-fixture change should be small and explained by the
code change that caused it. A regeneration that touches fixtures unrelated to your change usually
means the change had a wider effect than intended.

## Move commits

A commit that only relocates code (no logic change) should show as a pure rename in git's own
diff — verify with:

```
git show --summary <commit>
```

Look for `rename ... (100%)` on each moved file. Anything less than 100% means content changed in
the same commit as the move, which makes the history harder to bisect and the diff harder to review;
split the move and the change into separate commits instead.

## Pull requests

Keep a PR scoped to one package where possible. Cross-package changes (a `neuro-pil` contract change
that `akesi-pil` needs to follow) are fine, but call out the dependency in the PR description rather
than letting reviewers infer it from the diff.

## Releases

Merging to `main` auto-bumps the shared patch version (`0.1.43` → `0.1.44`) and tags/releases it —
CI's `release` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) does this after tests
pass, and its own commit carries `[skip ci]` so it doesn't trigger itself again. Don't hand-edit the
`version` field in either `package.json` — the automation owns patch.

A MINOR or MAJOR bump is still a human call: bump both `package.json`s yourself in a PR when a
change earns one (a new capability, a breaking API change). A [`CHANGELOG.md`](CHANGELOG.md) entry
is the same kind of deliberate, human-written call — not every patch bump gets one, only a release
worth explaining.
