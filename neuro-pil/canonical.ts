import type { Dag } from "./dag";
import { isStamped } from "./dag";

// Deterministic (sorted-key) JSON stringification, so the same logical value always canonicalizes to
// the same string regardless of property insertion order. `undefined` values are dropped rather than
// serialized (matching JSON.stringify's own behavior for object values) — do not "clean up" the
// `?.`/`.filter(Boolean)` here without checking every canonicalizer that relies on an unpopulated
// field disappearing rather than becoming `null` (that would change the string, and therefore the
// hash, for every existing record).
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return v === undefined ? "" : JSON.stringify(k) + ":" + stableStringify(v);
  }).filter(Boolean).join(",") + "}";
}

// One slice function per `source` node key: given the subject, return the exact raw datum that
// source node owns. The host defines what gets normalized (e.g. a patient's allergy list); the
// library only defines how normalized values combine into one canonical string per DAG node.
export type Slices<T> = Record<string, (subject: T) => unknown>;

// Canonical string of the source nodes a single DAG node depends on (its source closure) — a
// content-addressed cache key in the Nix/Bazel sense (README.md "Lineage"), just hashing declared
// clinical inputs instead of source files. An unknown key silently contributes no value
// (`slices[k]?.(subject)` -> `undefined` -> dropped by stableStringify) rather than throwing — see
// validate.ts's missing-slice rule for how that gap is caught instead, at lint time rather than at
// hash time.
export function canonicalFor<T>(dag: Dag, subject: T, slices: Slices<T>, nodeKey: string): string {
  const slice: Record<string, unknown> = {};
  for (const k of dag.sourceClosureOf(nodeKey)) slice[k] = slices[k]?.(subject);
  return stableStringify(slice);
}

// Canonical strings for every stamped node (kind !== "projection") — projections are self-hashed
// out-of-band and never appear in a stamp this function's caller would compare against.
export function canonicalMap<T>(dag: Dag, subject: T, slices: Slices<T>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of dag.nodes) if (isStamped(n)) out[n.key] = canonicalFor(dag, subject, slices, n.key);
  return out;
}

// Which stamped keys differ between a freshly-computed canonical map and a previously-stored one.
// Not change propagation: nothing is recomputed here, so a key whose stamp moved is reported stale
// even when regenerating it would have produced the same answer. That over-approximation is the
// deliberate trade — there is no re-execution to cut off on (see ARCHITECTURE.md § Lineage).
// Missing keys in `stamped` (a pre-existing stamp predating a new node) count as drifted.
export function driftedKeys(now: Record<string, string>, stamped: Record<string, string>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(now)) if (now[k] !== stamped[k]) out.push(k);
  return out;
}
