import { describe, it, expect } from "vitest";
import { reconcileGroups, markerGroupsHashOf, distinctMarkerNames } from "@pablotech/akesi-pil/marker-groups-prompt";
import { UNCATEGORIZED } from "@pablotech/akesi-pil/system-groups";
import type { Client, MarkerResult } from "@pablotech/akesi-pil/types";

const reading = (marker: string): MarkerResult => ({
  marker, group: "Panel", source: "Blood", date: "2026-01-01", value: 1, unit: "x",
});

function client(overrides: Partial<Client> = {}): Client {
  return { displayName: "T", dob: "1990-01-01", gender: "male", watchlist: [], results: [], ...overrides };
}

describe("reconcileGroups", () => {
  const systems = ["Metabolic Health", "Cardiovascular Risk"];

  it("keeps real markers, drops unknowns, places each exactly once (first group wins)", () => {
    const out = reconcileGroups(
      ["Homocysteine", "Vitamin B12", "ApoB"],
      systems,
      [
        { group: "Metabolic Health", markers: ["Homocysteine", "Vitamin B12", "Hallucinated Marker"] },
        { group: "Cardiovascular Risk", markers: ["Homocysteine", "ApoB"] }, // Homocysteine already placed
      ],
    );
    expect(out).toEqual([
      { group: "Metabolic Health", markers: ["Homocysteine", "Vitamin B12"] },
      { group: "Cardiovascular Risk", markers: ["ApoB"] },
    ]);
  });

  it("rejects a group name that isn't a verbatim body system — its markers are swept", () => {
    const out = reconcileGroups(
      ["ApoB", "Glucose"],
      ["Cardiovascular Risk"],
      [
        { group: "Cardiovascular Risk", markers: ["ApoB"] },
        { group: "Invented Theme", markers: ["Glucose"] },
      ],
    );
    expect(out).toEqual([
      { group: "Cardiovascular Risk", markers: ["ApoB"] },
      { group: UNCATEGORIZED, markers: ["Glucose"] },
    ]);
  });

  it("sweeps unplaced markers into a trailing 'Not yet categorized' group", () => {
    const out = reconcileGroups(["A", "B", "C"], ["Cardiovascular Risk"], [
      { group: "Cardiovascular Risk", markers: ["A"] },
    ]);
    expect(out).toEqual([
      { group: "Cardiovascular Risk", markers: ["A"] },
      { group: UNCATEGORIZED, markers: ["B", "C"] },
    ]);
  });

  it("merges leftovers into a model-placed 'Not yet categorized' rather than duplicating it", () => {
    const out = reconcileGroups(["A", "B", "C"], ["Cardiovascular Risk"], [
      { group: "Cardiovascular Risk", markers: ["A"] },
      { group: UNCATEGORIZED, markers: ["B"] },
    ]);
    expect(out).toEqual([
      { group: "Cardiovascular Risk", markers: ["A"] },
      { group: UNCATEGORIZED, markers: ["B", "C"] },
    ]);
  });
});

describe("markerGroupsHashOf", () => {
  it("is order-independent in both the marker set and the system set", () => {
    expect(markerGroupsHashOf(["A", "B"], ["S1", "S2"])).toBe(markerGroupsHashOf(["B", "A"], ["S2", "S1"]));
  });
  it("changes when the marker set changes", () => {
    expect(markerGroupsHashOf(["A", "B"], ["S1"])).not.toBe(markerGroupsHashOf(["A", "C"], ["S1"]));
  });
  it("changes when the System Analysis (disease groups) changes", () => {
    expect(markerGroupsHashOf(["A", "B"], ["S1"])).not.toBe(markerGroupsHashOf(["A", "B"], ["S2"]));
  });
});

describe("distinctMarkerNames", () => {
  it("dedups across readings and includes no-data watchlist markers, sorted", () => {
    const c = client({
      watchlist: ["Lp(a)", "ApoB"],
      results: [reading("ApoB"), reading("ApoB"), reading("Glucose")],
    });
    expect(distinctMarkerNames(c)).toEqual(["ApoB", "Glucose", "Lp(a)"]);
  });
});
