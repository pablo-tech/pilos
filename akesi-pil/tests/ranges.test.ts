import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveRange, ageYears, computeZones, currentZoneStatus } from "@pablotech/akesi-pil/ranges";
import type { Client, PersonalizedRange } from "@pablotech/akesi-pil/types";

const range = (factorsHash: string): PersonalizedRange =>
  ({ low: 10, high: 20, unit: "u", explanation: "", factorsHash } as PersonalizedRange);

const client = (over: Partial<Client>): Client => over as unknown as Client;

describe("resolveRange", () => {
  it("returns the personalized range for a marker, or null", () => {
    const c = client({ personalizedRanges: { ApoB: range("h1") } });
    expect(resolveRange("ApoB", c)).toEqual(range("h1"));
    expect(resolveRange("missing", c)).toBeNull();
    expect(resolveRange("ApoB", client({}))).toBeNull();
  });
});

describe("ageYears", () => {
  const asOf = new Date("2026-06-28T12:00:00Z");
  it("computes whole years for a birthday already passed this year", () => {
    expect(ageYears("2000-01-15", asOf)).toBe(26);
  });
  it("subtracts a year when the birthday has not yet occurred", () => {
    expect(ageYears("2000-12-31", asOf)).toBe(25);
  });
  it("returns null for empty or unparseable dates", () => {
    expect(ageYears("", asOf)).toBeNull();
    expect(ageYears("not-a-date", asOf)).toBeNull();
  });

  // W72 — the day BEFORE a birthday, which is where the bug lived. Every copy of this function parsed
  // the DOB as UTC and then read it back with LOCAL getters, so west of Greenwich the date component
  // came back one day early and the decrement did not fire. Measured before the fix:
  //
  //     UTC 25 (correct) · America/Los_Angeles 26 · Asia/Tokyo 25
  //
  // The value goes into the clinical prompt and age drives reference-range reasoning, so a patient's
  // stated age depended on which Cloudflare PoP served the request.
  it("does not turn 25 into 26 on the eve of a birthday", () => {
    expect(ageYears("2000-06-29", new Date("2026-06-28T12:00:00Z"))).toBe(25);
  });

  it("turns it over on the day itself, not before or after", () => {
    expect(ageYears("2000-06-28", new Date("2026-06-27T12:00:00Z"))).toBe(25);
    expect(ageYears("2000-06-28", new Date("2026-06-28T12:00:00Z"))).toBe(26);
    expect(ageYears("2000-06-28", new Date("2026-06-29T12:00:00Z"))).toBe(26);
  });

  // The regression guard proper, and it has to leave this process to be worth anything.
  //
  // vitest.config.ts pins TZ=UTC, which is right — it stops the golden fixture going flaky. But under
  // that pin local getters and UTC getters return the same numbers, so an in-process test cannot tell
  // the fixed implementation from the broken one. Reverting the fix and re-running this file passes
  // 21/21. A guard that cannot fail is not a guard.
  //
  // So this one actually runs the real function in a child process, in the timezone that broke.
  it.each(["America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"])(
    "gives the same answer in %s as it does in UTC",
    (tz) => {
      const out = execFileSync(
        "npx",
        ["tsx", "-e", `import { ageYears } from "@pablotech/akesi-pil/ranges"; process.stdout.write(String(ageYears("2000-06-29", new Date("2026-06-28T12:00:00Z"))));`],
        { cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."), env: { ...process.env, TZ: tz }, encoding: "utf8" },
      );
      expect(out.trim()).toBe("25");
    },
    30_000,
  );
});

describe("computeZones", () => {
  const bounds = (over: Partial<PersonalizedRange>): Pick<PersonalizedRange, "low" | "high" | "generalLow" | "generalHigh"> =>
    over;

  it("both bounds present each side: personalized is safe, general is the warn/danger edge", () => {
    const z = computeZones(bounds({ low: 10, high: 20, generalLow: 5, generalHigh: 25 }));
    expect(z).toEqual({
      safeLow: 10,
      safeHigh: 20,
      warnLowBound: 5,
      warnHighBound: 25,
      dangerLowBound: 5,
      dangerHighBound: 25,
    });
  });

  it("only personalized present: safe is the personalized bound, no warn or danger", () => {
    const z = computeZones(bounds({ low: 10, high: 20 }));
    expect(z).toEqual({
      safeLow: 10,
      safeHigh: 20,
      warnLowBound: null,
      warnHighBound: null,
      dangerLowBound: null,
      dangerHighBound: null,
    });
  });

  it("only general present: safe falls back to general, danger starts directly there, no warn", () => {
    const z = computeZones(bounds({ generalLow: 5, generalHigh: 25 }));
    expect(z).toEqual({
      safeLow: 5,
      safeHigh: 25,
      warnLowBound: null,
      warnHighBound: null,
      dangerLowBound: 5,
      dangerHighBound: 25,
    });
  });

  it("personalized equals general (no patient-specific adjustment): danger starts directly at the shared bound, no warn gap", () => {
    const z = computeZones(bounds({ low: 10, high: 20, generalLow: 10, generalHigh: 20 }));
    expect(z).toEqual({
      safeLow: 10,
      safeHigh: 20,
      warnLowBound: null,
      warnHighBound: null,
      dangerLowBound: 10,
      dangerHighBound: 20,
    });
  });

  it("personalized looser than general: danger still starts at the general bound", () => {
    const z = computeZones(bounds({ low: 3, high: 27, generalLow: 5, generalHigh: 25 }));
    expect(z.dangerLowBound).toBe(5);
    expect(z.dangerHighBound).toBe(25);
  });

  it("neither bound present on a side: open-ended, no danger", () => {
    const z = computeZones(bounds({}));
    expect(z).toEqual({
      safeLow: -Infinity,
      safeHigh: Infinity,
      warnLowBound: null,
      warnHighBound: null,
      dangerLowBound: null,
      dangerHighBound: null,
    });
  });

  it("no ranges at all (personal is null): open-ended, no danger", () => {
    const z = computeZones(null);
    expect(z).toEqual({
      safeLow: -Infinity,
      safeHigh: Infinity,
      warnLowBound: null,
      warnHighBound: null,
      dangerLowBound: null,
      dangerHighBound: null,
    });
  });
});

describe("currentZoneStatus", () => {
  const personal = (over: Partial<PersonalizedRange>): PersonalizedRange =>
    ({ low: 10, high: 20, generalLow: 5, generalHigh: 25, unit: "u", explanation: "", ...over } as PersonalizedRange);

  it("is unknown when there is no personalized range", () => {
    expect(currentZoneStatus(15, null)).toBe("unknown");
  });

  it("is unknown when there is no latest reading", () => {
    expect(currentZoneStatus(null, personal({}))).toBe("unknown");
  });

  it("is safe inside the personalized bounds", () => {
    expect(currentZoneStatus(15, personal({}))).toBe("safe");
    expect(currentZoneStatus(10, personal({}))).toBe("safe"); // boundary inclusive
    expect(currentZoneStatus(20, personal({}))).toBe("safe"); // boundary inclusive
  });

  it("is warn between the personalized and general bounds", () => {
    expect(currentZoneStatus(7, personal({}))).toBe("warn");
    expect(currentZoneStatus(23, personal({}))).toBe("warn");
  });

  it("is danger beyond the general bounds", () => {
    expect(currentZoneStatus(3, personal({}))).toBe("danger");
    expect(currentZoneStatus(30, personal({}))).toBe("danger");
  });

  it("is danger directly past a general-only bound (no warn gap)", () => {
    const p = personal({ low: undefined, high: undefined });
    expect(currentZoneStatus(4, p)).toBe("danger");
    expect(currentZoneStatus(26, p)).toBe("danger");
    expect(currentZoneStatus(15, p)).toBe("safe");
  });

  it("is danger directly past a bound where personalized equals general (no warn gap)", () => {
    // Regression: a value below a one-sided ">X" range whose personalized bound mirrors the
    // general bound (no patient-specific adjustment) must read danger, not safe.
    const p = personal({ low: 10, high: 20, generalLow: 10, generalHigh: 20 });
    expect(currentZoneStatus(9, p)).toBe("danger");
    expect(currentZoneStatus(21, p)).toBe("danger");
    expect(currentZoneStatus(15, p)).toBe("safe");
  });
});
