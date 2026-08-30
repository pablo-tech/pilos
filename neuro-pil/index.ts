// The isomorphic core: safe to import from a browser bundle, a Cloudflare Pages Function, or a
// node:crypto-based CLI alike. Runtime-specific hashing lives in ./hash-node and ./hash-web instead —
// import those directly rather than adding a `node:`/DOM-specific dependency here.
export type { NodeKind, DagNode, Dag } from "./dag";
export { defineDag, isStamped } from "./dag";
export type { Slices } from "./canonical";
export { stableStringify, canonicalFor, canonicalMap, driftedKeys } from "./canonical";
export type { MermaidBlockMarkers } from "./mermaid";
export { renderMermaid, extractDagBlock, writeDagBlock, DEFAULT_MERMAID_MARKERS } from "./mermaid";
export type { Finding, ValidateOptions } from "./validate";
export { validate, sliceParity } from "./validate";
