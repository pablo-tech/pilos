import type { Dag } from "./dag";

// A DAG diagram generated from the manifest itself, not hand-maintained, so the picture can never
// drift from the code. Keys off node key + label + inputs only, never `kind`, so it is unaffected by
// a source/derived rename.

export function renderMermaid(dag: Dag): string {
  const lines = ["graph LR"];
  for (const n of dag.nodes) lines.push(`  ${n.key}["${n.label}"]`);
  for (const n of dag.nodes) for (const dep of n.inputs) lines.push(`  ${dep} --> ${n.key}`);
  return lines.join("\n");
}

export interface MermaidBlockMarkers { start: string; end: string }

export const DEFAULT_MERMAID_MARKERS: MermaidBlockMarkers = { start: "<!-- DAG:START -->", end: "<!-- DAG:END -->" };

// The mermaid body currently checked into a doc (between the markers), or null if the markers/block
// are missing. Shared by the writer and a drift test so both parse the block identically.
export function extractDagBlock(docText: string, markers: MermaidBlockMarkers = DEFAULT_MERMAID_MARKERS): string | null {
  const s = docText.indexOf(markers.start);
  const e = docText.indexOf(markers.end);
  if (s < 0 || e < 0 || e < s) return null;
  const between = docText.slice(s + markers.start.length, e);
  const m = /```mermaid\n([\s\S]*?)\n```/.exec(between);
  return m ? m[1] : null;
}

// Rewrites the fenced block between the markers to the current renderMermaid(dag) output. Throws if
// the markers aren't present, rather than silently no-op'ing on a doc that was never wired up.
export function writeDagBlock(docText: string, dag: Dag, markers: MermaidBlockMarkers = DEFAULT_MERMAID_MARKERS): string {
  const s = docText.indexOf(markers.start);
  const e = docText.indexOf(markers.end);
  if (s < 0 || e < 0 || e < s) throw new Error(`markers ${markers.start} / ${markers.end} not found`);
  const block = `${markers.start}\n\n\`\`\`mermaid\n${renderMermaid(dag)}\n\`\`\`\n\n${markers.end}`;
  return docText.slice(0, s) + block + docText.slice(e + markers.end.length);
}
