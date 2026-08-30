// What this measures, and why it is built the way it is.
//
// README.md's claims about staleness are claims about OUTPUT: "a key whose stamp moved is reported
// stale even when regenerating it would have produced the same answer" (canonical.ts:46-48). A
// corpus that compares the engine's drift set against a graph walk cannot measure that — both sides
// are reachability, so the comparison is a graph identity that holds for any correct closure
// implementation and reports the same number whatever the engine does.
//
// So every derived node here carries a REAL derivation: a pure function of its inputs' values.
// Ground truth is an evaluation, not a walk — compute every node, perturb, compute again, and take
// the nodes whose value actually changed. That makes two quantities measurable:
//
//   false negatives  a node whose output changed and was NOT reported stale   -> soundness
//   false positives  a node reported stale whose output is identical          -> over-approximation
//
// The second is the number README.md § "What this trades away" is about and the reason the mix of
// derivations below matters: information-LOSSY derivations (a max, a threshold, a rounding) absorb
// upstream changes, and every node whose derivation absorbed one is a regeneration that would have
// been paid for nothing. A corpus of only information-preserving derivations cannot produce a single
// false positive and would report a precision of 1.000 no matter how coarse the engine was.
//
// The truth path never consults canonicalMap, driftedKeys, sourceClosureOf or downstreamOf. It reads
// `spec.inputs` one hop at a time because computing a value requires knowing what feeds it — that is
// evaluation, not reachability, and it is the one thing a ground truth for this claim cannot avoid.
//
//   npx tsx benchmarks/staleness-corpus.ts [--seed N] [--graphs N] [--json] [--no-scaling]
import { fileURLToPath } from "node:url";
import { defineDag, type Dag, type DagNode } from "../dag";
import { canonicalMap, driftedKeys, type Slices } from "../canonical";
import { validate, sliceParity } from "../validate";
import { sha256hex12 } from "../hash-node";

/** Source key -> the raw text that source owns. Slices normalize it; derivations read it. */
export type Subject = Record<string, string>;

/** `sum` is information-preserving: change any input and the output moves. The other four discard
 *  information, which is what lets a real upstream change leave a downstream value untouched. A
 *  clinical "elevated / normal" verdict is a threshold over a number, so this is the ordinary case
 *  rather than an adversarial one. */
export type DerivationKind = "sum" | "max" | "threshold" | "round" | "parity";

export const PRESERVING: DerivationKind[] = ["sum"];
export const LOSSY: DerivationKind[] = ["max", "threshold", "round", "parity"];

export interface Derivation {
  kind: DerivationKind;
  k: number;
}

export type Derivations = Record<string, Derivation>;

export interface Corpus {
  specs: DagNode[];
  dag: Dag;
  subject: Subject;
  slices: Slices<Subject>;
  derivations: Derivations;
}

export interface GraphShape {
  sources: number;
  derived: number;
  leaves: number;
  maxFanIn: number;
}

export const DEFAULT_SHAPE: GraphShape = { sources: 8, derived: 12, leaves: 4, maxFanIn: 3 };
export const DEFAULT_GRAPHS = 200;
export const DEFAULT_SEED = 20260830;

/** Prefix for the source nodes that the "declare the derivation" remedy introduces. Excluded from
 *  evaluation inputs — see evaluate(). */
export const PROMPT_PREFIX = "prompt/";

/** mulberry32 — small, seeded, identical across platforms, so a run reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The host-side normalization README.md names as the lever against over-approximation: formatting
 *  collapsed here never reaches the hash. Derivations normalize too, so a cosmetic edit changes no
 *  output either — which is what makes the cosmetic row a real precision measurement rather than an
 *  assertion about string handling. */
export function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A source node's value: the number its raw text carries, read through the same normalization. */
export function sourceValue(raw: string): number {
  const m = normalize(raw).match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

export function describeDerivation(d: Derivation): string {
  return `${d.kind} over inputs, k=${d.k}`;
}

export function applyDerivation(d: Derivation, inputs: number[]): number {
  const sum = inputs.reduce((a, b) => a + b, 0);
  switch (d.kind) {
    case "sum":
      return sum + d.k;
    case "max":
      return (inputs.length === 0 ? 0 : Math.max(...inputs)) + d.k;
    case "threshold":
      return sum > d.k ? 1 : 0;
    case "round":
      return Math.round(sum / d.k) * d.k;
    case "parity":
      return (sum + d.k) % 2;
  }
}

export function generateCorpus(seed: number, shape: GraphShape = DEFAULT_SHAPE): Corpus {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  const specs: DagNode[] = [];
  const derivations: Derivations = {};
  const sourceKeys: string[] = [];
  for (let i = 0; i < shape.sources; i++) {
    const key = `src/${i}`;
    sourceKeys.push(key);
    specs.push({ key, label: `source ${i}`, kind: "source", inputs: [], basis: `raw reading ${i}` });
  }

  // Every source gets a consumer, so a generated graph lints clean — an `orphan` finding would mean
  // the generator, not the engine, is what the corpus is measuring.
  const unconsumed = [...sourceKeys];
  const built: string[] = [...sourceKeys];

  const addNode = (key: string, kind: "derived" | "leaf", label: string) => {
    const inputs = new Set<string>();
    if (unconsumed.length > 0) inputs.add(unconsumed.shift() as string);
    const fanIn = 1 + Math.floor(rand() * shape.maxFanIn);
    while (inputs.size < fanIn) inputs.add(pick(built));
    // Roughly two lossy derivations for every preserving one. Both families have to be present: with
    // only preserving ones there are no false positives to find, with only lossy ones a false
    // negative could hide behind an absorbed change.
    const kind_ = rand() < 0.34 ? pick(PRESERVING) : pick(LOSSY);
    const d: Derivation = { kind: kind_, k: 2 + Math.floor(rand() * 40) };
    derivations[key] = d;
    specs.push({ key, label, kind, inputs: [...inputs], basis: describeDerivation(d) });
    built.push(key);
  };

  for (let i = 0; i < shape.derived; i++) addNode(`der/${i}`, "derived", `derived ${i}`);
  for (let i = 0; i < shape.leaves; i++) addNode(`leaf/${i}`, "leaf", `leaf ${i}`);

  // Any source still unconsumed is wired into the last node rather than left to trip validate()'s
  // orphan rule.
  if (unconsumed.length > 0) {
    const last = specs[specs.length - 1];
    last.inputs = [...new Set([...last.inputs, ...unconsumed])];
  }

  const subject: Subject = {};
  const slices: Slices<Subject> = {};
  for (const key of sourceKeys) {
    subject[key] = `  Reading ${Math.floor(rand() * 1000)}  `;
    slices[key] = (s) => normalize(s[key] ?? "");
  }

  return { specs, dag: defineDag(specs), subject, slices, derivations };
}

/** Ground truth. Every node's actual value, computed by running the derivations — never by asking
 *  the engine what it thinks moved. `specs` is in topological order by construction (a node's inputs
 *  are only ever drawn from nodes already built), so one forward pass suffices.
 *
 *  `prompt/*` inputs are skipped: the remedy's source node carries the derivation's own text, and
 *  that dependence is already expressed by `derivations[key]`. Feeding it in as a number too would
 *  count it twice and make the declared corpus compute different values from the plain one, which
 *  would leave the two conditions incomparable. */
export function evaluate(
  corpus: Corpus,
  subject: Subject = corpus.subject,
  derivations: Derivations = corpus.derivations,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const spec of corpus.specs) {
    if (spec.kind === "source") {
      values[spec.key] = sourceValue(subject[spec.key] ?? "");
      continue;
    }
    const inputs = spec.inputs.filter((i) => !i.startsWith(PROMPT_PREFIX)).map((i) => values[i] ?? 0);
    values[spec.key] = applyDerivation(derivations[spec.key], inputs);
  }
  return values;
}

/** The keys whose computed value actually differs — the only definition of "stale" that does not
 *  presuppose the engine's answer. */
export function changedKeys(before: Record<string, number>, after: Record<string, number>): Set<string> {
  const out = new Set<string>();
  for (const k of Object.keys(after)) if (before[k] !== after[k]) out.add(k);
  return out;
}

/** Every derivation rewritten: same graph, same sources, different function. `basis` moves with it,
 *  so the declared-derivation remedy has real content to hash. */
export function rewriteDerivations(derivations: Derivations): Derivations {
  const out: Derivations = {};
  for (const [key, d] of Object.entries(derivations)) out[key] = { kind: d.kind, k: d.k + 1 };
  return out;
}

/** The buy-back README.md § "What this does not catch" prescribes: re-declare every derivation as a
 *  source node, so the derivation text enters the closure like any other input. */
export function withDeclaredDerivations(corpus: Corpus): Corpus {
  const specs: DagNode[] = [];
  const subject: Subject = { ...corpus.subject };
  const slices: Slices<Subject> = { ...corpus.slices };

  for (const n of corpus.specs) {
    if (n.kind === "source") {
      specs.push(n);
      continue;
    }
    const promptKey = `${PROMPT_PREFIX}${n.key}`;
    specs.push({ key: promptKey, label: `derivation of ${n.key}`, kind: "source", inputs: [], basis: "the derivation itself" });
    specs.push({ ...n, inputs: [...n.inputs, promptKey] });
    subject[promptKey] = n.basis;
    slices[promptKey] = (s) => normalize(s[promptKey] ?? "");
  }

  return { specs, dag: defineDag(specs), subject, slices, derivations: corpus.derivations };
}

/** The subject for a declared corpus after its derivations are rewritten. */
export function declaredSubjectFor(corpus: Corpus, declared: Corpus, rewritten: Derivations): Subject {
  const out: Subject = { ...declared.subject };
  for (const n of corpus.specs) {
    if (n.kind === "source") continue;
    out[`${PROMPT_PREFIX}${n.key}`] = describeDerivation(rewritten[n.key]);
  }
  return out;
}

/** The universe every rate below is taken over: nodes something has to *produce*. A source is not
 *  regenerated, it is edited — so counting the source you just changed as a correctly-reported stale
 *  node pads the hit column with a triviality and flatters precision. The claim being measured is
 *  about what regeneration costs, so the denominator is what can be regenerated. */
const regenerableKeys = (specs: DagNode[]) =>
  new Set(specs.filter((n) => n.kind === "derived" || n.kind === "leaf").map((n) => n.key));

export interface Confusion {
  /** Output changed, engine stayed silent. The soundness failure. */
  missed: number;
  /** Engine reported stale, output identical. The over-approximation — unnecessary regeneration. */
  unnecessary: number;
  /** Reported and genuinely changed. */
  hit: number;
  /** Nodes whose output actually changed. */
  truth: number;
  /** Nodes the engine reported. */
  reported: number;
  /** Every node something has to produce — the denominator the no-tracking baseline regenerates. */
  regenerable: number;
}

const emptyConfusion = (): Confusion => ({ missed: 0, unnecessary: 0, hit: 0, truth: 0, reported: 0, regenerable: 0 });

/** What you do without any staleness tracking: regenerate everything. It is *also* sound — it misses
 *  nothing — which is what makes it the fair comparator for over-approximation. The engine is not
 *  competing against perfection here; it is competing against regenerating the lot. */
export function regenerateEverything(c: Confusion): Confusion {
  const { regenerable, truth } = c;
  return { missed: 0, unnecessary: regenerable - truth, hit: truth, truth, reported: regenerable, regenerable };
}

function accumulate(into: Confusion, truth: Set<string>, reported: string[], universe: Set<string>): void {
  const engine = new Set(reported.filter((k) => universe.has(k)));
  const real = new Set([...truth].filter((k) => universe.has(k)));
  for (const k of real) if (engine.has(k)) into.hit++;
  else into.missed++;
  for (const k of engine) if (!real.has(k)) into.unnecessary++;
  into.truth += real.size;
  into.reported += engine.size;
  into.regenerable += universe.size;
}

export type ConditionKey = "sourceEdit" | "cosmeticEdit" | "derivationEdit" | "derivationDeclared" | "sliceDropped";

export interface CorpusResult {
  graphs: number;
  seed: number;
  conditions: Record<ConditionKey, Confusion>;
  /** A deleted node's stamp is never revisited: driftedKeys iterates the fresh map. */
  deletedNode: { reported: number; total: number };
  /** sliceParity is the lint rule that names the gap hashing cannot see. */
  sliceParityCaught: { caught: number; total: number };
  lintClean: { clean: number; total: number };
  /** Distinct canonical strings seen, and distinct 12-hex-char hashes they produced. */
  collisions: { strings: number; hashes: number };
}

/** How a stamp is computed. Injectable for one reason: a row that scores the same for two different
 *  correct-looking engines is not measuring the engine. tests/staleness-corpus.test.ts runs a
 *  direct-input variant through this same corpus and asserts the soundness row separates them —
 *  and, in the other direction, that ground truth does NOT move when the engine is swapped. */
export type Engine = (corpus: Corpus, subject: Subject) => Record<string, string>;

export const sourceClosureEngine: Engine = (corpus, subject) => canonicalMap(corpus.dag, subject, corpus.slices);

export function runCorpus(
  seed = DEFAULT_SEED,
  graphs = DEFAULT_GRAPHS,
  shape: GraphShape = DEFAULT_SHAPE,
  engine: Engine = sourceClosureEngine,
): CorpusResult {
  const conditions = {
    sourceEdit: emptyConfusion(),
    cosmeticEdit: emptyConfusion(),
    derivationEdit: emptyConfusion(),
    derivationDeclared: emptyConfusion(),
    sliceDropped: emptyConfusion(),
  } as Record<ConditionKey, Confusion>;

  const r: CorpusResult = {
    graphs,
    seed,
    conditions,
    deletedNode: { reported: 0, total: 0 },
    sliceParityCaught: { caught: 0, total: 0 },
    lintClean: { clean: 0, total: 0 },
    collisions: { strings: 0, hashes: 0 },
  };

  const canonicalStrings = new Set<string>();

  for (let g = 0; g < graphs; g++) {
    const corpus = generateCorpus(seed + g, shape);
    const { specs, dag, subject, slices } = corpus;
    const regenerable = regenerableKeys(specs);
    const sources = specs.filter((n) => n.kind === "source");
    const target = sources[g % sources.length].key;

    r.lintClean.total++;
    if (validate(dag).length === 0) r.lintClean.clean++;

    const before = engine(corpus, subject);
    for (const s of Object.values(before)) canonicalStrings.add(s);
    const valuesBefore = evaluate(corpus);

    // A — a source edit. FN is the soundness claim; FP is the over-approximation claim.
    const moved: Subject = { ...subject, [target]: `  Reading ${sourceValue(subject[target]) + 7}  ` };
    const movedTruth = changedKeys(valuesBefore, evaluate(corpus, moved));
    accumulate(conditions.sourceEdit, movedTruth, driftedKeys(engine(corpus, moved), before), regenerable);

    // B — an edit the slice normalizes away. Nothing moved and nothing should be reported.
    const cosmetic: Subject = { ...subject, [target]: `\n  ${subject[target].toUpperCase()}   ` };
    const cosmeticTruth = changedKeys(valuesBefore, evaluate(corpus, cosmetic));
    accumulate(conditions.cosmeticEdit, cosmeticTruth, driftedKeys(engine(corpus, cosmetic), before), regenerable);

    // C — the documented blind spot. Every derivation rewritten, every source untouched.
    const rewritten = rewriteDerivations(corpus.derivations);
    const rewrittenSpecs = specs.map((n) => (n.kind === "source" ? n : { ...n, basis: describeDerivation(rewritten[n.key]) }));
    const rewrittenCorpus: Corpus = { ...corpus, specs: rewrittenSpecs, dag: defineDag(rewrittenSpecs), derivations: rewritten };
    const rewrittenTruth = changedKeys(valuesBefore, evaluate(corpus, subject, rewritten));
    accumulate(conditions.derivationEdit, rewrittenTruth, driftedKeys(engine(rewrittenCorpus, subject), before), regenerable);

    // D — the remedy: the same rewrite with the derivation declared as a source, same graph.
    const declared = withDeclaredDerivations(corpus);
    const declaredRegenerable = regenerableKeys(declared.specs);
    const declaredBefore = engine(declared, declared.subject);
    const declaredValuesBefore = evaluate(declared);
    const declaredAfter = declaredSubjectFor(corpus, declared, rewritten);
    const declaredTruth = changedKeys(declaredValuesBefore, evaluate(declared, declaredAfter, rewritten));
    accumulate(conditions.derivationDeclared, declaredTruth, driftedKeys(engine(declared, declaredAfter), declaredBefore), declaredRegenerable);

    // E — a source with no slice function. The same real edit as A, now invisible to the hash.
    const { [target]: _dropped, ...gapped } = slices;
    const gappedCorpus: Corpus = { ...corpus, slices: gapped };
    const gappedBefore = engine(gappedCorpus, subject);
    accumulate(conditions.sliceDropped, movedTruth, driftedKeys(engine(gappedCorpus, moved), gappedBefore), regenerable);
    r.sliceParityCaught.total++;
    if (sliceParity(dag, gapped).some((f) => f.rule === "missing-slice" && f.node === target)) r.sliceParityCaught.caught++;

    // F — a deleted node. ARCHITECTURE.md is explicit that driftedKeys iterates the fresh map, so a
    // key that has left the graph is never reported. The last spec is safe to remove: nothing was
    // built after it, so nothing consumes it.
    const victim = specs[specs.length - 1].key;
    const reducedSpecs = specs.filter((n) => n.key !== victim);
    const reduced: Corpus = { ...corpus, specs: reducedSpecs, dag: defineDag(reducedSpecs) };
    r.deletedNode.total++;
    if (driftedKeys(engine(reduced, subject), before).includes(victim)) r.deletedNode.reported++;
  }

  r.collisions.strings = canonicalStrings.size;
  r.collisions.hashes = new Set([...canonicalStrings].map(sha256hex12)).size;
  return r;
}

// --- reported alongside the corpus ------------------------------------------------------------

/** Probability that some pair among `n` random 48-bit hashes collides — the birthday bound for the
 *  truncation ARCHITECTURE.md calls a deliberate tradeoff without giving it a number. */
export function collisionProbability(n: number, bits = 48): number {
  return -Math.expm1((-n * (n - 1)) / (2 * Math.pow(2, bits)));
}

export interface ScalingPoint {
  nodes: number;
  ms: number;
}

/** A chain: the worst case for depth, and the shape README.md's "cheap by construction at any
 *  depth" is about. Each node's source closure is walked from scratch with no memoization between
 *  nodes (canonical.ts:33,41), so depth d costs a walk of length d. */
function chainSpecs(nodes: number): DagNode[] {
  const specs: DagNode[] = [{ key: "src/0", label: "source", kind: "source", inputs: [], basis: "raw" }];
  for (let i = 1; i < nodes; i++) {
    specs.push({ key: `der/${i}`, label: `derived ${i}`, kind: "derived", inputs: [i === 1 ? "src/0" : `der/${i - 1}`], basis: "chain" });
  }
  return specs;
}

/** A wide, shallow random graph at the same node counts — reported alongside the chain so the
 *  exponent below cannot be dismissed as an artefact of one pathological shape. */
function wideSpecs(nodes: number, seed: number): DagNode[] {
  const sources = Math.max(1, Math.floor(nodes / 4));
  const corpus = generateCorpus(seed, { sources, derived: nodes - sources - 1, leaves: 1, maxFanIn: 3 });
  return corpus.specs;
}

function timeCanonicalMap(specs: DagNode[]): number {
  const dag = defineDag(specs);
  const subject: Subject = {};
  const slices: Slices<Subject> = {};
  for (const n of specs) {
    if (n.kind !== "source") continue;
    subject[n.key] = `Reading ${n.key.length}`;
    slices[n.key] = (s) => normalize(s[n.key] ?? "");
  }
  const started = performance.now();
  canonicalMap(dag, subject, slices);
  return performance.now() - started;
}

export function scalingCurve(
  shape: "chain" | "wide" = "chain",
  sizes: number[] = [250, 500, 1000, 2000],
  seed = DEFAULT_SEED,
): ScalingPoint[] {
  return sizes.map((nodes) => ({
    nodes,
    ms: timeCanonicalMap(shape === "chain" ? chainSpecs(nodes) : wideSpecs(nodes, seed)),
  }));
}

/** Least-squares slope of log(ms) against log(nodes) — the empirical growth exponent. 1 would mean
 *  linear; 2 means the cost is quadratic in graph size. */
export function fitExponent(points: ScalingPoint[]): number {
  const usable = points.filter((p) => p.ms > 0);
  const n = usable.length;
  if (n < 2) return NaN;
  const xs = usable.map((p) => Math.log(p.nodes));
  const ys = usable.map((p) => Math.log(p.ms));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
  return num / den;
}

// --- rendering ---------------------------------------------------------------------------------

/** A count with its rate, or the bare count when there is no denominator to take a rate against —
 *  never "n/a", because 0 out of 0 reported is itself the result the cosmetic row exists to show. */
const share = (n: number, d: number) => (d === 0 ? String(n) : `${n} (${((n / d) * 100).toFixed(1)}%)`);

export interface ConditionRow {
  condition: string;
  changed: string;
  missed: string;
  reported: string;
  unnecessary: string;
  note: string;
}

const CONDITION_NOTES: Record<ConditionKey, [string, string]> = {
  sourceEdit: ["Source edit", "one source value changed"],
  cosmeticEdit: ["Cosmetic edit", "a change the slice normalizes away"],
  derivationEdit: ["Derivation edit", "every derivation rewritten, sources untouched"],
  derivationDeclared: ["Derivation declared", "the same rewrite, derivation declared as a source"],
  sliceDropped: ["Slice dropped", "the source edit again, with that source's slice removed"],
};

export function conditionRows(r: CorpusResult): ConditionRow[] {
  return (Object.keys(CONDITION_NOTES) as ConditionKey[]).map((key) => {
    const c = r.conditions[key];
    const [label, note] = CONDITION_NOTES[key];
    return {
      condition: label,
      changed: String(c.truth),
      missed: share(c.missed, c.truth),
      reported: String(c.reported),
      unnecessary: share(c.unnecessary, c.reported),
      note,
    };
  });
}

export function renderTable(r: CorpusResult): string {
  const head =
    "| Condition | Output changed | Missed | Reported stale | Unnecessary | |\n|---|---|---|---|---|---|";
  const body = conditionRows(r)
    .map((w) => `| ${w.condition} | ${w.changed} | **${w.missed}** | ${w.reported} | **${w.unnecessary}** | ${w.note} |`)
    .join("\n");
  return `${head}\n${body}`;
}

export interface PriceRow {
  policy: string;
  regenerated: number;
  wasted: string;
  missed: number;
}

/** The three anchors that make the over-approximation rate mean anything. All three are sound, so
 *  the comparison is purely about waste. The floor is unreachable rather than merely unbuilt:
 *  knowing which regenerations to skip means computing them, and a derivation that cannot be
 *  re-run is the premise of the whole package. */
export function priceRows(r: CorpusResult): PriceRow[] {
  const engine = r.conditions.sourceEdit;
  const all = regenerateEverything(engine);
  return [
    { policy: "No tracking — regenerate everything", regenerated: all.reported, wasted: share(all.unnecessary, all.reported), missed: all.missed },
    { policy: "neuro-pil", regenerated: engine.reported, wasted: share(engine.unnecessary, engine.reported), missed: engine.missed },
    { policy: "An oracle — unreachable", regenerated: engine.truth, wasted: share(0, engine.truth), missed: 0 },
  ];
}

/** The single figure the price table exists to produce: how much of the waste you would pay without
 *  any tracking the engine removes. Printed rather than left for a reader to divide, because a
 *  figure derived by hand is a figure nothing re-checks when the corpus moves. */
export function wasteRemoved(r: CorpusResult): number {
  const engine = r.conditions.sourceEdit;
  const all = regenerateEverything(engine);
  return (all.unnecessary - engine.unnecessary) / all.unnecessary;
}

export function renderPrice(r: CorpusResult): string {
  const head = "| Policy | Regenerated | Wasted | Missed |\n|---|---|---|---|";
  const body = priceRows(r)
    .map((p) => `| ${p.policy} | ${p.regenerated} | **${p.wasted}** | ${p.missed} |`)
    .join("\n");
  const removed = `\nTracking removes ${(wasteRemoved(r) * 100).toFixed(1)}% of the waste you pay without it.`;
  return `${head}\n${body}\n${removed}`;
}

function main(): void {
  const arg = (flag: string, fallback: number) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? fallback : Number(process.argv[i + 1]);
  };
  const seed = arg("--seed", DEFAULT_SEED);
  const graphs = arg("--graphs", DEFAULT_GRAPHS);

  const started = Date.now();
  const result = runCorpus(seed, graphs);
  const elapsed = Date.now() - started;

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`neuro-pil staleness corpus — ${graphs} graphs, seed ${seed}, ${elapsed}ms`);
  console.log(`Ground truth is the set of nodes whose recomputed value differs.\n`);
  console.log(renderTable(result));
  console.log(`\nThe price of a source edit, against the alternatives — all three miss nothing:`);
  console.log(renderPrice(result));
  console.log(
    `\nDeleted node reported stale: ${result.deletedNode.reported}/${result.deletedNode.total}` +
      `\nsliceParity names the missing slice: ${result.sliceParityCaught.caught}/${result.sliceParityCaught.total}` +
      `\nGenerated graphs linting clean: ${result.lintClean.clean}/${result.lintClean.total}` +
      `\nCanonical strings seen: ${result.collisions.strings}, distinct 48-bit hashes: ${result.collisions.hashes}`,
  );

  console.log(`\nCollision probability at 48 bits (birthday bound):`);
  for (const n of [1e3, 1e4, 1e5, 1e6]) {
    console.log(`  ${n.toExponential(0).padStart(6)} stamps: ${(collisionProbability(n) * 100).toPrecision(3)}%`);
  }

  if (!process.argv.includes("--no-scaling")) {
    for (const shape of ["chain", "wide"] as const) {
      const curve = scalingCurve(shape);
      console.log(`\ncanonicalMap over a ${shape} graph:`);
      for (const p of curve) console.log(`  ${String(p.nodes).padStart(5)} nodes: ${p.ms.toFixed(1)}ms`);
      console.log(`  fitted growth exponent: ${fitExponent(curve).toFixed(2)} (1.0 = linear, 2.0 = quadratic)`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
