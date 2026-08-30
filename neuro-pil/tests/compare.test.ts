import { describe, it, expect } from "vitest";
import { compareBrains } from "../compare";

describe("compareBrains", () => {
  it("scores each version against every case and reports the mean", async () => {
    const result = await compareBrains(
      ["a", "bb", "ccc"],
      ["upper", "reverse"],
      async (c: string, v: string) => (v === "upper" ? c.toUpperCase() : [...c].reverse().join("")),
      (r: string, c: string) => (r.length === c.length ? 1 : 0),
    );
    expect(result.perVersion).toEqual([
      { version: "upper", scores: [1, 1, 1], mean: 1 },
      { version: "reverse", scores: [1, 1, 1], mean: 1 },
    ]);
  });

  it("distinguishes versions that score differently", async () => {
    const result = await compareBrains(
      [1, 2, 3],
      ["double", "identity"],
      async (c: number, v: string) => (v === "double" ? c * 2 : c),
      (r: number, c: number) => (r === c * 2 ? 1 : 0),
    );
    expect(result.perVersion.find((v) => v.version === "double")?.mean).toBe(1);
    expect(result.perVersion.find((v) => v.version === "identity")?.mean).toBe(0);
  });

  it("supports an async scorer", async () => {
    const result = await compareBrains(
      ["x"],
      ["only"],
      async () => "x",
      async (r: string, c: string) => (r === c ? 1 : 0),
    );
    expect(result.perVersion).toEqual([{ version: "only", scores: [1], mean: 1 }]);
  });

  it("means an empty case set to 0, not NaN", async () => {
    const result = await compareBrains<string, string, string>([], ["v1"], async (c, v) => v, () => 1);
    expect(result.perVersion).toEqual([{ version: "v1", scores: [], mean: 0 }]);
  });

  it("means an empty version set to no rows", async () => {
    const result = await compareBrains<string, string, string>(["a"], [], async (c, v) => v, () => 1);
    expect(result.perVersion).toEqual([]);
  });
});
