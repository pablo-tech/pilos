import type { Dag } from "./dag";
import type { Slices } from "./canonical";

export interface Finding {
  rule: string;
  node: string;
  message: string;
}

export interface ValidateOptions {
  // source-kind nodes with zero downstream consumers are flagged as `orphan` (dead wiring — data
  // collected that nothing ever reads) unless their key is listed here. derived/leaf/projection nodes
  // are exempt: a "generated together" or "input-local" artifact is routinely also a terminal report
  // section shown directly to the user, not just an intermediate computation step — verified against
  // the live Finding DAG, where several `derived` nodes (e.g. healthProgression) are legitimately
  // terminal and would otherwise false-positive on every run.
  terminalAllowlist?: string[];
}

// Structural checks over the graph shape alone — no host data (a subject, a stamp, a slices map)
// required. See sliceParity() below for the one check that needs a host's slice map too.
export function validate(dag: Dag, opts: ValidateOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const keys = new Set(dag.nodes.map((n) => n.key));
  const allowlist = new Set(opts.terminalAllowlist ?? []);

  const seenKeys = new Set<string>();
  for (const n of dag.nodes) {
    if (seenKeys.has(n.key)) findings.push({ rule: "duplicate-key", node: n.key, message: `duplicate node key "${n.key}"` });
    seenKeys.add(n.key);

    for (const dep of n.inputs) {
      if (!keys.has(dep)) findings.push({ rule: "unknown-input", node: n.key, message: `"${n.key}" lists unknown input "${dep}"` });
    }

    if (n.kind === "source" && n.inputs.length > 0) {
      findings.push({ rule: "source-has-inputs", node: n.key, message: `source node "${n.key}" declares inputs — sources are raw, never derived` });
    }
  }

  for (const n of dag.nodes) {
    const path = cyclePath(dag, n.key);
    if (path) findings.push({ rule: "cycle", node: n.key, message: `cycle: ${path.join(" -> ")}` });
  }

  const downstreamCount = new Map<string, number>(dag.nodes.map((n) => [n.key, 0]));
  for (const n of dag.nodes) for (const dep of n.inputs) downstreamCount.set(dep, (downstreamCount.get(dep) ?? 0) + 1);
  for (const n of dag.nodes) {
    if (n.kind === "source" && downstreamCount.get(n.key) === 0 && !allowlist.has(n.key)) {
      findings.push({ rule: "orphan", node: n.key, message: `"${n.key}" (source) is consumed by nothing — collected but never read by anything downstream` });
    }
  }

  for (const n of dag.nodes) {
    for (const dep of n.inputs) {
      if (dag.dagNode(dep)?.note && !n.noteSink) {
        findings.push({ rule: "note-feeds-non-sink", node: n.key, message: `"${n.key}" consumes note "${dep}" but isn't a noteSink — notes must never become evidence` });
      }
    }
  }

  return findings;
}

// The one node/edge relationship not captured by `Dag` alone: which source keys a host's slice map
// (the functions that turn a subject into hashable data — see canonicalFor in canonical.ts) actually
// covers. A source with no matching slice silently contributes nothing to any node's canonical string
// (canonicalFor's `slices[k]?.(subject)` -> undefined); a slice with no matching source is dead code.
export function sliceParity<T>(dag: Dag, slices: Slices<T>): Finding[] {
  const findings: Finding[] = [];
  const sourceKeys = new Set(dag.nodes.filter((n) => n.kind === "source").map((n) => n.key));
  for (const k of sourceKeys) {
    if (!(k in slices)) findings.push({ rule: "missing-slice", node: k, message: `source "${k}" has no matching slice function` });
  }
  for (const k of Object.keys(slices)) {
    if (!sourceKeys.has(k)) findings.push({ rule: "missing-slice", node: k, message: `slice "${k}" doesn't match any source node` });
  }
  return findings;
}

// DFS returning the actual cycle path (not just a boolean) the first time `start` is revisited on its
// own walk. Re-run per node rather than memoized across the whole graph — the graphs this validates
// are tens of nodes, not thousands, so the O(n^2) worst case is not worth the complexity to avoid.
function cyclePath(dag: Dag, start: string): string[] | null {
  const path: string[] = [];
  const visit = (k: string): string[] | null => {
    const idx = path.indexOf(k);
    if (idx !== -1) return [...path.slice(idx), k];
    path.push(k);
    for (const dep of dag.dagNode(k)?.inputs ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    path.pop();
    return null;
  };
  return visit(start);
}
