import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dag } from "./dag";
import { isStamped } from "./dag";
import type { Slices } from "./canonical";
import { canonicalFor, driftedKeys } from "./canonical";
import type { Finding } from "./validate";
import { validate } from "./validate";
import { renderMermaid, writeDagBlock } from "./mermaid";
import { dagFromFiles, parseVaultNode } from "./markdown";
import { sha256hex12 } from "./hash-node";

// The vault-mode front-end over the same Dag type the TypeScript manifest front-end uses
// (index.ts) — see README.md. Walks a directory tree of plain markdown/YAML vault files rather than
// a compiled manifest, for a non-code consumer that has no toolchain.

export type Command = "lint" | "mermaid" | "stale";
const COMMANDS: readonly Command[] = ["lint", "mermaid", "stale"];

export interface ParsedArgs {
  command: Command;
  dir: string;
  write?: string;
  update?: boolean;
  json?: boolean;
}

// Hand-rolled arg parsing — no new dependency for three flags.
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, dir, ...rest] = argv;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`unknown subcommand "${command ?? ""}". Expected one of: ${COMMANDS.join(", ")}`);
  }
  if (!dir) throw new Error(`${command} requires a <dir> argument`);
  const out: ParsedArgs = { command: command as Command, dir };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--write") out.write = rest[++i];
    else if (a === "--update") out.update = true;
    else if (a === "--json") out.json = true;
    else throw new Error(`unknown flag "${a}"`);
  }
  return out;
}

// Recursive readdir, collecting *.md (frontmatter nodes) and *.neuro-pil.yml (bare folder
// manifests) into path -> raw text. Skips .git, node_modules, .neuro-pil (the stale stamp dir),
// and any other dotfile/dotdir.
export function walkVault(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (entry.name.endsWith(".md") || entry.name.endsWith(".neuro-pil.yml")) out[p] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

export interface LintResult {
  findings: Finding[];
  nodeCount: number;
}

// No sliceParity here — that check needs a host's slice map, and vault mode has no analogue for one
// (see canonical.ts); it's a TS-manifest-only lint, run separately by whichever host wires slices up.
export function runLint(dir: string): LintResult {
  const dag = dagFromFiles(walkVault(dir));
  return { findings: validate(dag), nodeCount: dag.nodes.length };
}

export function runMermaid(dir: string): string {
  return renderMermaid(dagFromFiles(walkVault(dir)));
}

// One slice per source node key -> that node's own raw file text, keyed by node key rather than
// path (a node's key comes from its frontmatter, not its filename).
function subjectOf(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const text of Object.values(files)) {
    const meta = parseVaultNode(text);
    if (meta) out[meta.node] = text;
  }
  return out;
}

function slicesOf(dag: Dag): Slices<Record<string, string>> {
  const slices: Slices<Record<string, string>> = {};
  for (const n of dag.nodes) if (n.kind === "source") slices[n.key] = (subject) => subject[n.key];
  return slices;
}

function stampPathOf(dir: string): string {
  return join(dir, ".neuro-pil", "stamp.json");
}

export interface StaleResult {
  baseline: boolean;
  drifted: string[];
  nodeCount: number;
}

// The same nodeHashesOf/staleNodesOf pattern the TypeScript manifest front-end uses, applied to a
// vault directory instead of a compiled Dag. Read-only by default — the stamp is written only when
// opts.update is true, matching this package's "read-only first" doctrine for anything touching a
// real vault.
export function runStale(dir: string, opts: { update?: boolean } = {}): StaleResult {
  const files = walkVault(dir);
  const dag = dagFromFiles(files);
  const subject = subjectOf(files);
  const slices = slicesOf(dag);
  const now: Record<string, string> = {};
  for (const n of dag.nodes) if (isStamped(n)) now[n.key] = sha256hex12(canonicalFor(dag, subject, slices, n.key));

  const stampPath = stampPathOf(dir);
  const stamped: Record<string, string> | null = existsSync(stampPath)
    ? JSON.parse(readFileSync(stampPath, "utf8"))
    : null;
  const baseline = stamped === null;
  const drifted = baseline ? [] : driftedKeys(now, stamped);

  if (opts.update) {
    mkdirSync(join(dir, ".neuro-pil"), { recursive: true });
    writeFileSync(stampPath, JSON.stringify(now, null, 2) + "\n");
  }

  return { baseline, drifted, nodeCount: dag.nodes.length };
}

// Drift is reported before the "wrote stamp" line, including under --update: the drift is measured
// against the *old* stamp (runStale computes it before overwriting), and without this a --update run
// that exits 1 would print nothing about why.
export function staleLines(
  result: StaleResult,
  opts: { dir: string; update?: boolean; json?: boolean },
): string[] {
  if (opts.json) return [JSON.stringify({ ...result, updated: opts.update === true })];

  const lines: string[] = [];
  if (result.baseline) lines.push("no prior stamp — nothing to compare.");
  else if (result.drifted.length === 0) lines.push(`neuro-pil: no drift across ${result.nodeCount} stamped nodes.`);
  else for (const k of result.drifted) lines.push(`[stale] ${k}`);

  if (opts.update) lines.push(`Wrote stamp for ${result.nodeCount} nodes into ${stampPathOf(opts.dir)}`);
  return lines;
}

function requireDir(dir: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`no such directory: ${dir}`);
  }
}

function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
    requireDir(parsed.dir);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  if (parsed.command === "lint") {
    const result = runLint(parsed.dir);
    if (parsed.json) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else if (result.findings.length === 0) {
      process.stdout.write(`neuro-pil: no findings across ${result.nodeCount} nodes.\n`);
    } else {
      for (const f of result.findings) process.stdout.write(`[${f.rule}] ${f.node}: ${f.message}\n`);
    }
    if (result.findings.length > 0) process.exitCode = 1;
    return;
  }

  if (parsed.command === "mermaid") {
    if (parsed.write) {
      const doc = readFileSync(parsed.write, "utf8");
      const dag = dagFromFiles(walkVault(parsed.dir));
      writeFileSync(parsed.write, writeDagBlock(doc, dag));
      process.stdout.write(`Wrote ${dag.nodes.length}-node mermaid into ${parsed.write}\n`);
    } else {
      process.stdout.write(runMermaid(parsed.dir) + "\n");
    }
    return;
  }

  // stale
  const result = runStale(parsed.dir, { update: parsed.update });
  for (const line of staleLines(result, { dir: parsed.dir, update: parsed.update, json: parsed.json })) {
    process.stdout.write(line + "\n");
  }
  if (result.drifted.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
