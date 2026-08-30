// A brain-comparison harness: given a case set, a set of candidate versions, a way to run one version
// against one case, and a way to score the result, report each version's scores. See
// ./ARCHITECTURE.md and ../akesi-pil/ARCHITECTURE.md for why this exists and what it deliberately
// doesn't do.
//
// `run` and `score` are the entire extension surface, on purpose: this does not call any model
// provider, does not assume Anthropic or any other vendor, and does not compete with an eval platform
// (PromptLayer, Langfuse, Portkey, Helicone, MLflow) an adopter may already run. Wire `run` to whichever
// SDK, self-hosted model, or nothing at all a given brain currently uses — the harness never sees it.
//
// `Case`, `Version`, and `Result` are deliberately opaque type parameters, not a shared `BrainEntry`
// shape: an adopter's own registry entry is passed through untouched as `Version`, whatever shape it
// happens to be.

export interface VersionScore<Version> {
  version: Version;
  scores: number[];
  mean: number;
}

export interface Comparison<Version> {
  perVersion: VersionScore<Version>[];
}

export async function compareBrains<Case, Version, Result>(
  cases: Case[],
  versions: Version[],
  run: (c: Case, v: Version) => Promise<Result>,
  score: (result: Result, c: Case) => number | Promise<number>,
): Promise<Comparison<Version>> {
  const perVersion: VersionScore<Version>[] = [];
  for (const version of versions) {
    const scores: number[] = [];
    for (const c of cases) {
      scores.push(await score(await run(c, version), c));
    }
    const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
    perVersion.push({ version, scores, mean });
  }
  return { perVersion };
}
