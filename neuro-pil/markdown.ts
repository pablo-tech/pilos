import type { Dag, DagNode, NodeKind } from "./dag";
import { defineDag } from "./dag";

// The second front-end for the same Dag type — a plain-markdown vault convention, alongside the
// TypeScript manifest front-end (defineDag). Built to prove the shape works for a no-toolchain
// consumer before any concrete vault needs it.
//
// Deliberately NOT a general YAML parser — only the flat scalar/flow-list/block-list/boolean subset
// this schema needs (no nesting beyond one list, no anchors, no block scalars). If a future vault's
// frontmatter needs more than this, that's the point at which a real YAML dependency earns its keep;
// not before there's a second real consumer to justify adding one.

export interface VaultNodeMeta {
  node: string;
  kind: NodeKind;
  label?: string;
  inputs?: string[];
  basis?: string;
  note?: boolean;
  noteSink?: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

// The frontmatter block's raw text (between the `---` delimiters), or null if the file has none —
// e.g. a `.neuro-pil.yml` folder manifest has no delimiters at all, just the block directly.
export function extractFrontmatter(text: string): string | null {
  const m = FRONTMATTER.exec(text);
  return m ? m[1] : null;
}

function unquote(s: string): string {
  const v = s.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parseScalar(raw: string): string | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return unquote(v);
}

function parseFlowList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((s) => unquote(s));
}

// One key per line: `key: value`, `key: [a, b, c]` (flow list), or `key:` followed by `  - item`
// lines (block list). Not a general YAML parser — see the module comment above.
export function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const lines = block.split(/\r?\n/);
  const out: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const listItem = /^\s+-\s*(.+)$/.exec(line);
    if (listItem && currentListKey) {
      (out[currentListKey] as string[]).push(unquote(listItem[1]));
      continue;
    }
    currentListKey = null;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === "") {
      out[key] = [];
      currentListKey = key;
    } else if (rest.trim().startsWith("[")) {
      out[key] = parseFlowList(rest);
    } else {
      out[key] = parseScalar(rest);
    }
  }
  return out;
}

// Parses one file's frontmatter (or, for a `.neuro-pil.yml` folder manifest, the whole file) into
// a node descriptor. Returns null for a file with no frontmatter, or missing the two required keys
// (`node`, `kind`) — silently skipped by dagFromFiles rather than thrown, since a vault will always
// have plenty of files (a README, a legal PDF's sibling notes) that were never meant to be graph
// nodes at all.
export function parseVaultNode(text: string): VaultNodeMeta | null {
  const block = extractFrontmatter(text) ?? (/^[A-Za-z_][\w-]*:/.test(text) ? text : null);
  if (!block) return null;
  const parsed = parseFrontmatterBlock(block);
  if (typeof parsed.node !== "string" || typeof parsed.kind !== "string") return null;
  return {
    node: parsed.node,
    kind: parsed.kind as NodeKind,
    label: typeof parsed.label === "string" ? parsed.label : undefined,
    inputs: Array.isArray(parsed.inputs) ? (parsed.inputs as string[]) : [],
    basis: typeof parsed.basis === "string" ? parsed.basis : "",
    note: parsed.note === true,
    noteSink: parsed.noteSink === true,
  };
}

// Builds a Dag from a set of already-read file contents (path -> text). The host walks the
// filesystem and reads files; this module only knows how to turn text into a Dag, not how to find
// it — keeps this library free of any node:fs dependency.
export function dagFromFiles(files: Record<string, string>): Dag {
  const nodes: DagNode[] = [];
  for (const text of Object.values(files)) {
    const meta = parseVaultNode(text);
    if (!meta) continue;
    nodes.push({
      key: meta.node,
      label: meta.label ?? meta.node,
      kind: meta.kind,
      inputs: meta.inputs ?? [],
      basis: meta.basis ?? "",
      ...(meta.note ? { note: true as const } : {}),
      ...(meta.noteSink ? { noteSink: true as const } : {}),
    });
  }
  return defineDag(nodes);
}
