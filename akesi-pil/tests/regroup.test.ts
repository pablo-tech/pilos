import { describe, it, expect } from "vitest";
import {
  buildRegroupInputs,
  regroupUserPrompt,
  validateRegroup,
  resolveRegroup,
  type RegroupResponse,
} from "@pablotech/akesi-pil/finding-regroup";
import type { Client } from "@pablotech/akesi-pil/types";

function ai(intervention: string, purpose = "") {
  return { intervention, purpose, pros: [], cons: [], alternatives: [], recommendation: "" };
}

function client(): Client {
  return {
    displayName: "Alex",
    dob: "1980-01-01",
    gender: "male",
    watchlist: [],
    results: [],
    factors: {
      decisions: [{ intervention: "Methylation stack", purpose: "overnight HRV" }],
      treatments: [{ name: "Start statin or statin-like approach", kind: "behavior", start: "2099-06" }],
    },
    finding: {
      disease: [
        { group: "Cardiovascular Risk", finding: "x" },
        { group: "Methylation / Nutrient Status", finding: "y" },
      ],
      decisions: { patient: [], ai: [ai("Rosuvastatin", "Cut ApoB"), ai("PCSK9 inhibitor", "Escalation")] },
    },
  } as unknown as Client;
}

// A well-formed partition referencing the ids buildRegroupInputs assigns.
function validResp(): RegroupResponse {
  return {
    groups: [
      { system: "S1", topic: "Lipid-lowering", patient: ["A1"], ai: ["AI1", "AI2"] },
      { system: "S2", topic: "Methyl donors", patient: ["P1"], ai: [] },
    ],
  };
}

describe("finding-regroup inputs + ids", () => {
  it("assigns S#/P#/A#/AI# ids across systems, hypotheses, plan actions, and AI items", () => {
    const inputs = buildRegroupInputs(client());
    expect(inputs.systems).toEqual([
      { id: "S1", name: "Cardiovascular Risk" },
      { id: "S2", name: "Methylation / Nutrient Status" },
    ]);
    expect(inputs.patientHypotheses.map((p) => p.id)).toEqual(["P1"]);
    expect(inputs.planActions.map((a) => a.id)).toEqual(["A1"]);
    expect(inputs.aiInterventions.map((a) => a.id)).toEqual(["AI1", "AI2"]);
  });

  it("the prompt references ids, never asking for verbatim echo", () => {
    const p = regroupUserPrompt(buildRegroupInputs(client()));
    expect(p).toContain("S1: Cardiovascular Risk");
    expect(p).toContain("A1: Start statin or statin-like approach");
    expect(p).toContain("AI1: Rosuvastatin");
    expect(p).not.toMatch(/verbatim/i);
  });
});

describe("finding-regroup validation (id contract)", () => {
  const inputs = buildRegroupInputs(client());

  it("accepts a well-formed id-ref partition", () => {
    expect(() => validateRegroup(validResp(), inputs)).not.toThrow();
  });

  it("rejects a ref that is not a known id (the failure class id-refs remove)", () => {
    const r = validResp();
    r.groups[0].ai = ["Rosuvastatin"]; // verbatim text, not an AI# id
    expect(() => validateRegroup(r, inputs)).toThrow(/not an AI# id/);
  });

  it("rejects an unplaced AI item (coverage)", () => {
    const r = validResp();
    r.groups[0].ai = ["AI1"]; // AI2 now unplaced
    expect(() => validateRegroup(r, inputs)).toThrow(/AI2 is not placed/);
  });

  it("rejects an unplaced patient item (coverage over P# and A#)", () => {
    const r: RegroupResponse = {
      groups: [
        { system: "S1", topic: "Lipid-lowering", patient: ["A1"], ai: ["AI1"] },
        { system: "S2", topic: "Methyl donors", patient: [], ai: ["AI2"] }, // P1 now unplaced, group still non-empty
      ],
    };
    expect(() => validateRegroup(r, inputs)).toThrow(/P1 is not placed/);
  });

  it("rejects a duplicated ref", () => {
    const r = validResp();
    r.groups[1].ai = ["AI1"]; // AI1 already in group 0
    expect(() => validateRegroup(r, inputs)).toThrow(/appears in more than one group/);
  });

  it("rejects out-of-order systems", () => {
    const r: RegroupResponse = {
      groups: [
        { system: "S2", topic: "Methyl donors", patient: ["P1"], ai: [] },
        { system: "S1", topic: "Lipid-lowering", patient: ["A1"], ai: ["AI1", "AI2"] },
      ],
    };
    expect(() => validateRegroup(r, inputs)).toThrow(/out of order/);
  });

  it("rejects a system that reappears after another (non-adjacent → caught as out-of-order)", () => {
    const r: RegroupResponse = {
      groups: [
        { system: "S1", topic: "Lipid-lowering", patient: ["A1"], ai: ["AI1"] },
        { system: "S2", topic: "Methyl donors", patient: ["P1"], ai: [] },
        { system: "S1", topic: "ARB", patient: [], ai: ["AI2"] },
      ],
    };
    expect(() => validateRegroup(r, inputs)).toThrow(/out of order/);
  });

  it("rejects a group with neither patient nor ai items", () => {
    const r = validResp();
    r.groups.push({ system: "S2", topic: "Empty", patient: [], ai: [] });
    expect(() => validateRegroup(r, inputs)).toThrow(/neither patient nor ai/);
  });
});

describe("finding-regroup resolve", () => {
  it("maps ids back to the stored TreatmentGroup[] verbatim-text shape", () => {
    const inputs = buildRegroupInputs(client());
    const groups = resolveRegroup(validResp(), inputs);
    expect(groups).toEqual([
      { system: "Cardiovascular Risk", topic: "Lipid-lowering", patient: ["Start statin or statin-like approach"], ai: ["Rosuvastatin", "PCSK9 inhibitor"] },
      { system: "Methylation / Nutrient Status", topic: "Methyl donors", patient: ["Methylation stack"], ai: [] },
    ]);
  });
});
