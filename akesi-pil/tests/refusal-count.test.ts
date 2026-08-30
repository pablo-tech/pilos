import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// "96 distinct refusals" is the strongest claim this package makes, and it was a hand-count repeated
// in five places across three documents — true the day it was written, and silently false in all
// five at once the moment anyone adds a check. The number is derivable, so it gets derived.

const HERE = dirname(fileURLToPath(import.meta.url));

/** One refusal is one `throw`: the assembler has no other rejection mechanism. */
const refusals = (readFileSync(resolve(HERE, "../finding-assemble.ts"), "utf8").match(/\bthrow /g) ?? []).length;

/** Every markdown file in the package and at the repo root, so a new site is checked without being
 *  listed — a site nobody remembered to add is exactly the drift this guards. */
const docs = [resolve(HERE, ".."), resolve(HERE, "../..")].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f)),
);

/** The claim's own phrasings. Narrow on purpose: "12 distinct cases" in BENCHMARKS.md is a sample
 *  size, not a refusal count, and a guard that conflates them fails for the wrong reason. */
const CLAIM = /(\d+) distinct (?:code-level )?(?:refusals|validation failures|checks)/g;

describe("the published refusal count is the one the assembler raises", () => {
  it("agrees with every document that states it", () => {
    const wrong: string[] = [];
    let sites = 0;
    for (const doc of docs) {
      // Prose wraps at ~100 chars, so a claim is routinely split across two lines.
      for (const [, stated] of readFileSync(doc, "utf8").replace(/\s+/g, " ").matchAll(CLAIM)) {
        sites += 1;
        if (Number(stated) !== refusals) wrong.push(`${doc.split("/").slice(-2).join("/")} states ${stated}`);
      }
    }
    expect(wrong, `finding-assemble.ts raises ${refusals}`).toEqual([]);
    // Pinned, not `> 0`: a site rephrased out of CLAIM would otherwise drop out of the guard
    // silently, which is the same blindness in a different place. Changing this is a deliberate act.
    expect(sites, "a document stating the count was added, removed, or reworded").toBe(5);
  });
});
