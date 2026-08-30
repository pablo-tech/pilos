const enc = new TextEncoder();

// SubtleCrypto variant of the truncated-SHA-256 hash, for the browser and Cloudflare Pages Functions
// (workerd exposes the same Web Crypto API). See hash-node.ts for the node:crypto twin.
export async function sha256hex12(str: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(str) as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
