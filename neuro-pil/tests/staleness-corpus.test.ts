import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineDag } from "../dag";
import {
  DEFAULT_GRAPHS,
  DEFAULT_SEED,
  DEFAULT_SHAPE,
  LOSSY,
  PRESERVING,
  applyDerivation,
  changedKeys,
  collisionProbability,
  conditionRows,
  evaluate,
  fitExponent,
  generateCorpus,
  normalize,
  priceRows,
  regenerateEverything,
  wasteRemoved,
  rewriteDerivations,
  runCorpus,
  sourceClosureEngine,
  sourceValue,
  withDeclaredDerivations,
  type Corpus,
  type ConditionKey,
  type Engine,
} from "../benchmarks/staleness-corpus";

// A benchmark that reports the same number whatever the code does is measuring nothing, and the
// usual defence — break the engine, watch the rate move — only proves a row READS the engine. It
// does not prove the row DISCRIMINATES: a graph identity moves under mutation too, while still
// scoring identically for every implementation that is correct. So the first describe block below
// runs a second, plausible, correct-looking engine through the same corpus and requires the
// soundness row to separate the two. Mutation sits alongside as the weaker complement.

const GRAPHS = 40;

/** The alternative: stamp each node from its DIRECT inputs rather than its transitive source
 *  closure. Nothing about it looks wrong on inspection — it is roughly what a first attempt at
 *  this engine produces — and it is unsound, because a source edit two hops up never reaches the
 *  stamp. sourceClosureOf is the choice that fixes it, and the soundness row is what prices it. */
const directInputEngine: Engine = (corpus, subject) => {
  const out: Record<string, string> = {};
  for (const spec of corpus.specs) {
    const self = corpus.slices[spec.key]?.(subject) ?? "";
    const inputs = spec.inputs.map((i) => `${i}=${corpus.slices[i]?.(subject) ?? ""}`).sort();
    out[spec.key] = `${spec.key}|${spec.kind}|${self}|${inputs.join(",")}`;
  }
  return out;
};

/** A pure mutation: every stamp constant, so nothing is ever reported. */
const inertEngine: Engine = (corpus) => Object.fromEntries(corpus.specs.map((n) => [n.key, "constant"]));

const CONDITIONS: ConditionKey[] = ["sourceEdit", "cosmeticEdit", "derivationEdit", "derivationDeclared", "sliceDropped"];

describe("the corpus discriminates between engines, not just between mutations", () => {
  const real = runCorpus(DEFAULT_SEED, GRAPHS);
  const direct = runCorpus(DEFAULT_SEED, GRAPHS, undefined, directInputEngine);

  it("scores the shipped engine sound on a source edit, and a direct-input engine unsound", () => {
    expect(real.conditions.sourceEdit.missed).toBe(0);
    expect(direct.conditions.sourceEdit.missed).toBeGreaterThan(0);
  });

  it("separates the two on precision as well — the row is not saturated at either end", () => {
    const realFp = real.conditions.sourceEdit.unnecessary;
    const directFp = direct.conditions.sourceEdit.unnecessary;
    expect(realFp).toBeGreaterThan(0);
    expect(realFp).not.toBe(directFp);
  });

  it("reports 100% missed for an engine that stamps nothing — the weaker mutation check", () => {
    const inert = runCorpus(DEFAULT_SEED, GRAPHS, undefined, inertEngine);
    expect(inert.conditions.sourceEdit.missed).toBe(inert.conditions.sourceEdit.truth);
    expect(inert.conditions.sourceEdit.reported).toBe(0);
  });

  it("holds ground truth fixed while the engine changes — truth cannot be reading the engine", () => {
    // The direct check on the plan's second verification item: if any part of the truth path
    // consulted canonicalMap or a closure walk, swapping the engine would move these totals.
    for (const key of CONDITIONS) {
      expect(direct.conditions[key].truth).toBe(real.conditions[key].truth);
      expect(runCorpus(DEFAULT_SEED, GRAPHS, undefined, inertEngine).conditions[key].truth).toBe(real.conditions[key].truth);
    }
  });
});

describe("the claims each condition is filed under", () => {
  const r = runCorpus(DEFAULT_SEED, GRAPHS);

  it("misses nothing on a source edit — soundness, the package's premise", () => {
    expect(r.conditions.sourceEdit.truth).toBeGreaterThan(0);
    expect(r.conditions.sourceEdit.missed).toBe(0);
  });

  it("over-approximates on a source edit, and the size of that is the trade being priced", () => {
    const { unnecessary, reported } = r.conditions.sourceEdit;
    expect(unnecessary).toBeGreaterThan(0);
    expect(unnecessary).toBeLessThan(reported);
  });

  it("changes nothing and reports nothing for an edit the slice normalizes away", () => {
    expect(r.conditions.cosmeticEdit.truth).toBe(0);
    expect(r.conditions.cosmeticEdit.reported).toBe(0);
  });

  it("misses every derivation rewrite — the blind spot, in the same units as every other row", () => {
    const { truth, missed } = r.conditions.derivationEdit;
    expect(truth).toBeGreaterThan(0);
    expect(missed).toBe(truth);
  });

  it("misses none of the same rewrite once the derivation is declared as a source", () => {
    const { truth, missed } = r.conditions.derivationDeclared;
    expect(truth).toBeGreaterThan(0);
    expect(missed).toBe(0);
  });

  it("misses every real change when a source has no slice function, and sliceParity names it", () => {
    const { truth, missed, reported } = r.conditions.sliceDropped;
    expect(missed).toBe(truth);
    expect(reported).toBe(0);
    expect(r.sliceParityCaught.caught).toBe(r.sliceParityCaught.total);
  });

  it("never reports a deleted node — driftedKeys iterates the fresh map, not the stored one", () => {
    expect(r.deletedNode.reported).toBe(0);
    expect(r.deletedNode.total).toBe(GRAPHS);
  });

  it("generates graphs that lint clean, so the corpus measures the engine and not the generator", () => {
    expect(r.lintClean.clean).toBe(r.lintClean.total);
  });
});

describe("the deleted-node row measures a choice, not a law", () => {
  it("a union-iterating comparison reports the same deletion the shipped one skips", () => {
    // canonical.ts compares `now` against `stamped` by walking `now`. Walking the union instead is
    // the obvious alternative and it catches deletions — which is what makes 0/N a finding about
    // this engine rather than a fact about staleness.
    const corpus = generateCorpus(DEFAULT_SEED);
    const victim = corpus.specs[corpus.specs.length - 1].key;
    const reduced: Corpus = { ...corpus, specs: corpus.specs.filter((n) => n.key !== victim) };
    const before = sourceClosureEngine(corpus, corpus.subject);
    const after = sourceClosureEngine({ ...reduced, dag: defineDag(reduced.specs) }, corpus.subject);
    const union = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter((k) => after[k] !== before[k]);
    expect(union).toContain(victim);
  });
});

describe("the price row compares against something, not against perfection", () => {
  // A wasted-regeneration rate is unreadable on its own — 43.6% could be a scandal or a bargain.
  // It is a bargain only if the alternative is worse, so the row prices the alternative:
  // regenerating everything, which is what you do without this library and is equally sound. The
  // ordering below is the published claim; if it inverted, the row would be arguing against itself.
  const r = runCorpus(DEFAULT_SEED, GRAPHS);
  const engine = r.conditions.sourceEdit;
  const all = regenerateEverything(engine);

  it("keeps the baseline sound, so the comparison is about waste and nothing else", () => {
    expect(all.missed).toBe(0);
    expect(engine.missed).toBe(0);
  });

  it("orders the three anchors: an oracle regenerates least, no-tracking most", () => {
    expect(engine.truth).toBeLessThan(engine.reported);
    expect(engine.reported).toBeLessThan(all.reported);
  });

  it("wastes strictly more without tracking — the whole reason the engine earns its rate", () => {
    expect(all.unnecessary).toBeGreaterThan(engine.unnecessary);
  });

  it("prints a removed-waste figure that agrees with the table a reader is looking at", () => {
    // The published sentence is this number, and the check is that it reconciles with the rendered
    // cells rather than with the expression that produced it — otherwise the assertion restates the
    // implementation and would survive any error the two make together.
    const rows = priceRows(r);
    const wastedFrom = (policy: string) => Number(rows.find((p) => p.policy.startsWith(policy))!.wasted.split(" ")[0]);
    const baseline = wastedFrom("No tracking");
    const tracked = wastedFrom("neuro-pil");
    expect(wasteRemoved(r)).toBeCloseTo(1 - tracked / baseline, 12);
    expect(tracked).toBeLessThan(baseline);
  });

  it("takes every rate over what is regenerated, not over what is edited", () => {
    // A source is edited, never regenerated: counting the one you just changed as a correctly
    // reported stale node pads the hit column and flatters precision. If sources crept back into
    // the universe this count would jump by the graph's eight of them.
    const specs = generateCorpus(DEFAULT_SEED).specs;
    const perGraph = specs.filter((n) => n.kind === "derived" || n.kind === "leaf").length;
    expect(perGraph).toBeLessThan(specs.length);
    expect(engine.regenerable).toBe(perGraph * GRAPHS);
  });
});

describe("the generator makes over-approximation possible at all", () => {
  const corpus = generateCorpus(DEFAULT_SEED);
  const kinds = new Set(Object.values(corpus.derivations).map((d) => d.kind));

  it("mixes information-lossy and information-preserving derivations", () => {
    // With only preserving derivations every reported node would genuinely have changed and the
    // precision row would read 100% regardless of the engine — a tautology by corpus design.
    expect([...kinds].some((k) => LOSSY.includes(k))).toBe(true);
    expect([...kinds].some((k) => PRESERVING.includes(k))).toBe(true);
  });

  it("has lossy derivations that really do absorb an upstream change", () => {
    expect(applyDerivation({ kind: "max", k: 0 }, [10, 3])).toBe(applyDerivation({ kind: "max", k: 0 }, [10, 4]));
    expect(applyDerivation({ kind: "threshold", k: 5 }, [9])).toBe(applyDerivation({ kind: "threshold", k: 5 }, [11]));
    expect(applyDerivation({ kind: "sum", k: 0 }, [9])).not.toBe(applyDerivation({ kind: "sum", k: 0 }, [11]));
  });

  it("evaluates a declared corpus to the same values as the plain one it was built from", () => {
    // The prompt source nodes exist to be hashed, not to be summed: if they fed the arithmetic the
    // declared condition would be computing different outputs and the two rows would not compare.
    const declared = withDeclaredDerivations(corpus);
    const plain = evaluate(corpus);
    const withPrompts = evaluate(declared);
    for (const key of Object.keys(plain)) expect(withPrompts[key]).toBe(plain[key]);
  });

  it("moves real outputs when the derivations are rewritten", () => {
    const rewritten = rewriteDerivations(corpus.derivations);
    expect(changedKeys(evaluate(corpus), evaluate(corpus, corpus.subject, rewritten)).size).toBeGreaterThan(0);
  });
});

describe("the pure helpers the corpus is built on", () => {
  it("normalizes whitespace and case, which is what makes a cosmetic edit cosmetic", () => {
    expect(normalize("  Reading   42 \n")).toBe("reading 42");
    expect(normalize("READING 42")).toBe(normalize("reading 42"));
  });

  it("reads a source's value through the same normalization", () => {
    expect(sourceValue("  Reading 42  ")).toBe(42);
    expect(sourceValue("\n READING   42 ")).toBe(sourceValue("reading 42"));
  });

  it("prices the 48-bit truncation with the birthday bound", () => {
    expect(collisionProbability(1)).toBe(0);
    expect(collisionProbability(1e6)).toBeGreaterThan(collisionProbability(1e5));
    expect(collisionProbability(1e6)).toBeCloseTo(0.00177, 4);
  });

  it("recovers a known exponent from synthetic points", () => {
    expect(fitExponent([{ nodes: 10, ms: 100 }, { nodes: 100, ms: 10000 }])).toBeCloseTo(2, 6);
    expect(fitExponent([{ nodes: 10, ms: 10 }, { nodes: 100, ms: 100 }])).toBeCloseTo(1, 6);
  });
});

describe("the run is reproducible from its seed", () => {
  it("returns byte-identical results for two runs at one seed", () => {
    expect(JSON.stringify(runCorpus(DEFAULT_SEED, 10))).toBe(JSON.stringify(runCorpus(DEFAULT_SEED, 10)));
  });

  it("renders a row per condition", () => {
    expect(conditionRows(runCorpus(DEFAULT_SEED, 10)).map((row) => row.condition)).toHaveLength(CONDITIONS.length);
  });
});

// Everything above asserts a property of the engine. None of it asserts that the page a reader is
// actually looking at still says what the run says — and a published figure nobody re-checks is
// precisely the failure this benchmark exists to argue against. So this block reconciles
// BENCHMARKS.md against a live run at the published seed and graph count.
describe("BENCHMARKS.md publishes what the run printed", () => {
  const r = runCorpus(DEFAULT_SEED, DEFAULT_GRAPHS);
  const doc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "BENCHMARKS.md"), "utf8");

  /** Every markdown table row in the page, as its cells with bold markers stripped. */
  const rows = doc
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("**", "").trim()),
    );

  /** Matches on the row's own cells rather than on its label, so rewording prose cannot break this
   *  and changing a number cannot survive it. `width` pins which table can satisfy the match. */
  const published = (width: number, want: string[]) =>
    rows.some((row) => row.length === width && want.every((value, i) => row[i + 1] === value));

  /** Prose wraps at ~100 chars, so a published sentence is routinely split across lines. */
  const prose = doc.replace(/\s+/g, " ");

  const engine = priceRows(r).find((p) => p.policy === "neuro-pil")!;
  const everything = priceRows(r).find((p) => p.policy.startsWith("No tracking"))!;
  const pct = (cell: string) => cell.match(/\(([\d.]+)%\)/)![1];
  const count = (cell: string) => cell.split(" ")[0];

  it("carries every condition row exactly as the corpus renders it", () => {
    for (const row of conditionRows(r)) {
      expect(
        published(5, [row.changed, row.missed, row.reported, row.unnecessary]),
        `no published row matches the ${row.condition} condition`,
      ).toBe(true);
    }
  });

  it("carries every price row exactly as the corpus renders it", () => {
    for (const row of priceRows(r)) {
      expect(
        published(4, [String(row.regenerated), row.wasted, String(row.missed)]),
        `no published row matches the ${row.policy} policy`,
      ).toBe(true);
    }
  });

  it("states the headline rates in prose that agrees with the tables", () => {
    expect(prose).toContain(`${pct(engine.wasted)}% wasted, against ${pct(everything.wasted)}% for regenerating everything`);
    expect(prose).toContain(`${count(engine.wasted)} of the ${engine.regenerated} regenerations`);
    expect(prose).toContain(
      `**${(wasteRemoved(r) * 100).toFixed(1)}% of the wasted regenerations** — ${count(everything.wasted)} down to ${count(engine.wasted)}`,
    );
  });

  it("names the run every count came from", () => {
    const nodes = DEFAULT_SHAPE.sources + DEFAULT_SHAPE.derived + DEFAULT_SHAPE.leaves;
    expect(prose).toContain(`${r.graphs} graphs of ${nodes} nodes, seed ${r.seed}`);
  });

  it("carries the three further rows' figures", () => {
    expect(prose).toContain(`**${r.deletedNode.reported}/${r.deletedNode.total} reported**`);
    expect(prose).toContain(`**${r.collisions.strings - r.collisions.hashes} collisions in ${r.collisions.strings} stamps**`);
    expect(prose).toContain(`**${(collisionProbability(1e5) * 100).toFixed(4)}% at 10⁵**`);
    expect(prose).toContain(`**${(collisionProbability(1e6) * 100).toFixed(2)}% at 10⁶**`);
  });
});
