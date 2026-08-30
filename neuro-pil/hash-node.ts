import { createHash } from "node:crypto";

// node:crypto variant of the truncated-SHA-256 hash. Kept separate from the isomorphic core (dag.ts,
// canonical.ts) so nothing that runs in a browser or a Cloudflare Pages Function ever pulls in
// node:crypto — see hash-web.ts for that path.
export function sha256hex12(str: string): string {
  return createHash("sha256").update(str).digest("hex").slice(0, 12);
}
