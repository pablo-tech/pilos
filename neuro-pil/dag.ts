// The generalized shape of a source -> derived -> leaf/projection dependency graph.
//
// upstreamOf/downstreamOf/sourceClosureOf are the dependency-closure walk any build-graph engine in
// this lineage needs (see README.md "Lineage") — the set of nodes to recompute is exactly the
// downstream closure of what changed, never a human-maintained list.

export type NodeKind = "source" | "derived" | "leaf" | "projection";

export interface DagNode {
  key: string;
  label: string;
  kind: NodeKind;
  inputs: string[]; // keys of upstream nodes
  basis: string; // the human sentence describing what this node is derived from
  // Commentary, not evidence — never allowed to feed a node other than a `noteSink` (validate.ts's
  // note-feeds-non-sink rule). Kept as a flag rather than a fifth NodeKind so it never changes a
  // node's `source`-set membership, which is what canonical hashing keys off — see canonical.ts.
  note?: true;
  // The only kind of node allowed to consume a `note` node in its `inputs`.
  noteSink?: true;
}

export interface Dag {
  nodes: DagNode[];
  dagNode(key: string): DagNode | undefined;
  // Transitive upstream (everything this node depends on, directly or indirectly).
  upstreamOf(key: string): Set<string>;
  // Transitive downstream (everything that would be invalidated if this node changed).
  downstreamOf(key: string): Set<string>;
  // The `source` nodes a node ultimately depends on (its transitive upstream, filtered to sources,
  // plus itself if it is itself a source). Every derived node is a deterministic function of the
  // source nodes above it, so hashing over exactly this closure invalidates precisely the nodes whose
  // sources actually changed. Sorted for a stable canonical order.
  sourceClosureOf(key: string): string[];
}

// Pins, stars, and other UI-only attention flags are deliberately NOT modeled here — never a node,
// never an edge. They must not affect any canonical string (see canonical.ts's pinNeutrality helper).

export function isStamped(node: DagNode): boolean {
  return node.kind !== "projection";
}

export function defineDag(nodes: DagNode[]): Dag {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const dagNode = (key: string) => byKey.get(key);

  const upstreamOf = (key: string): Set<string> => {
    const out = new Set<string>();
    const walk = (k: string) => {
      for (const dep of byKey.get(k)?.inputs ?? []) {
        if (!out.has(dep)) { out.add(dep); walk(dep); }
      }
    };
    walk(key);
    return out;
  };

  const downstreamOf = (key: string): Set<string> => {
    const children = (k: string) => nodes.filter((n) => n.inputs.includes(k)).map((n) => n.key);
    const out = new Set<string>();
    const walk = (k: string) => {
      for (const c of children(k)) {
        if (!out.has(c)) { out.add(c); walk(c); }
      }
    };
    walk(key);
    return out;
  };

  const sourceKeys = new Set(nodes.filter((n) => n.kind === "source").map((n) => n.key));

  const sourceClosureOf = (key: string): string[] => {
    const closure = new Set<string>();
    if (sourceKeys.has(key)) closure.add(key);
    for (const u of upstreamOf(key)) if (sourceKeys.has(u)) closure.add(u);
    return [...closure].sort();
  };

  return { nodes, dagNode, upstreamOf, downstreamOf, sourceClosureOf };
}
