import { describe, it, expect } from "vitest";
import { LEAF_OWNED_BASIS_KEYS, assembleFinding, validateFindingResponse, validateFindingWithInputs } from "@pablotech/akesi-pil/finding-assemble";

function rep(s: string, n: number) {
  return Array.from({ length: n }, () => s).join(" ");
}
const PROSE = rep("Lorem ipsum dolor sit amet.", 12);

function decisionFixture(intervention: string, purpose: string) {
  return {
    intervention,
    purpose,
    pros: ["pro one with enough chars", "pro two with enough chars", "pro three with enough chars"],
    cons: ["con one with enough chars", "con two with enough chars", "con three with enough chars"],
    alternatives: ["alt one with enough chars", "alt two with enough chars"],
    recommendation: rep("Recommendation sentence here.", 8),
  };
}

function baseValid() {
  return {
    progression: { latest: PROSE, recent: PROSE, overall: PROSE },
    studyResults: [
      { study: "Suspicion", result: rep("Suspicion result sentence.", 6), group: "Cardiovascular Risk" },
      { study: "Effect", result: rep("Effect result sentence.", 6), group: "Metabolic Health" },
    ],
    noteResults: [
      { result: rep("Note result sentence.", 6), group: "Cardiovascular Risk" },
    ],
    patternAntipattern: { pattern: PROSE, antipattern: PROSE },
    clinicalSynthesis: { adverse: PROSE, favorable: PROSE, conditioning: PROSE },
    criticalRatios: [
      { name: "Triglycerides : HDL", numerator: "Triglycerides", denominator: "HDL", unit: "", meaning: "Insulin-resistance proxy.", generalLow: 0, generalHigh: 2, generalExplanation: "guideline band", personalizedLow: 0, personalizedHigh: 1.5, explanation: "tighter for CV risk" },
      { name: "Total cholesterol : HDL", numerator: "Total cholesterol", denominator: "HDL", unit: "", meaning: "Atherogenic balance.", generalHigh: 5, generalExplanation: "guideline band", personalizedHigh: 3.5, explanation: "tighter for secondary prevention" },
    ],
    disease: [
      { group: "Cardiovascular Risk", finding: rep("CV finding sentence.", 8) },
      { group: "Metabolic Health", finding: rep("Metabolic finding sentence.", 8) },
      { group: "Hormonal / Endocrine", finding: rep("Hormonal finding sentence.", 8) },
      { group: "Hepatic", finding: rep("Hepatic finding sentence.", 8) },
    ],
    treatment: [
      { item: "Ezetimibe 10 mg", assessment: rep("Ezetimibe assessment sentence.", 6), group: "Cardiovascular Risk" },
      { item: "Vitamin D 5000 IU", assessment: rep("Vitamin D assessment sentence.", 6), group: "Metabolic Health" },
    ],
    decisions: {
      patient: [decisionFixture("TRT", "improved free T")],
      ai: [decisionFixture("Statin or PCSK9 inhibitor", "lower ApoB to <60 against residual 76")],
    },
    doctorConversation: [
      { group: "Cardiovascular Risk", questions: ["Ask about ApoB target."] },
      { group: "Metabolic Health", questions: ["Ask about HbA1c trend."] },
      { group: "Hormonal / Endocrine", questions: ["Ask about Free T basis."] },
      { group: "Hepatic", questions: ["Ask about FibroScan timing."] },
      { group: "TRT", questions: ["Ask about enclomiphene first."] },
      { group: "Statin or PCSK9 inhibitor", questions: ["Ask which is right for me."] },
    ],
    definitions: [
      { term: "ApoB", definition: "Apolipoprotein B — artery-clogging cholesterol carrier.", group: "Cardiovascular Risk" },
      { term: "HbA1c", definition: "Glycated hemoglobin — 3-month average blood sugar.", group: "Metabolic Health" },
      { term: "TRT", definition: "Testosterone replacement therapy — exogenous testosterone.", group: "Hormonal / Endocrine" },
    ],
    healthMarkers: {
      recommended: [
        { group: "Cardiovascular Risk", markers: [{ name: "ApoB", rationale: "rationale at least ten chars" }] },
        { group: "Hormonal / Endocrine", markers: [{ name: "Free T", rationale: "rationale at least ten chars" }] },
      ],
    },
    dataRequisition: [
      { type: "Blood", group: "Cardiovascular Risk", items: ["Lp(a) — distinguish inherited lipoprotein risk"] },
      { type: "Scan / Imaging", group: "Cardiovascular Risk", items: ["Repeat CAC — 5 years since prior cardiac imaging"] },
    ],
    // Every decisions.ai intervention must be placed in exactly one group (AI-side coverage).
    treatmentGroups: [
      { system: "Cardiovascular Risk", topic: "Lipid-lowering", patient: ["TRT"], ai: ["Statin or PCSK9 inhibitor"] },
    ],
    basis: {
      // user-entered sections use Shape A: literal "Based on user input."
      patientAssessment: "Based on user input.",
      patientProfile: "Based on user input.",
      statedObjective: "Based on user input.",
      pursuedStudy: "Based on user input.",
      pursuedNotes: "Based on user input.",
      diagnosedDisease: "Based on user input.",
      treatmentHistory: "Based on user input.",
      correlationHistory: "Based on user input.",
      patientHypothesis: "Based on user input.",
      // LLM-inferred sections use Shape B: name the input sections (Title Case)
      markerLevels: "Based on your lab data (user input) and AI-inferred personalized levels from Patient Assessment (user input).",
      aiFindings: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      healthProgression: "Based on your lab data and Marker Levels (raw user data and AI).",
      studyResults: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      noteResults: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      possibleFindings: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      treatmentAssessment: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      dataRequisition: "Based on Patient Assessment (user input) and Marker Levels (raw user data and AI).",
      aiHypothesis: "Based on Patient Assessment (user input), Marker Levels (raw user data and AI), and AI Findings (AI).",
      hypothesisEvaluation: "Based on Patient Assessment (user input), Marker Levels (raw user data and AI), Patient Hypothesis (user input), AI Findings (AI), and AI Hypothesis (AI).",
      doctorConversation: "Based on Patient Assessment (user input), Marker Levels (raw user data and AI), Patient Hypothesis (user input), AI Findings (AI), AI Hypothesis (AI), and Hypothesis Evaluation (AI).",
      healthMarkers: "Based on your Watchlist (user input) and the Finding's Recommended set (AI).",
      patientPlan: "Based on user input.",
      patternAntipattern: "Based on Patient Assessment (user input), Marker Levels (raw user data and AI), and AI Findings (AI).",
      clinicalSynthesis: "Based on Diagnosed Disease (user input), Health Finding (AI), Marker Levels (raw user data and AI), and Treatment History (user input).",
      criticalRatios: "Based on your lab data, Diagnosed Disease (user input), and Health Finding (AI).",
      aiOnPlan: "Based on Patient Plan (user input), Patient Assessment (user input), and AI Findings (AI).",
      finalThoughts: "Based on every section of this report (user input and AI).",
      abbreviations: "Based on every other section (user input and AI) in this report.",
      treatmentGroups: "Based on Patient Hypothesis (user input), Patient Plan (user input), and AI Hypothesis (AI).",
    },
    planAssessment: PROSE,
    planAssessmentRows: [] as { action: string; assessment: string }[],
    finalThoughts: PROSE,
  };
}

describe("validateFindingResponse", () => {
  it("accepts a fully-formed valid response with patient + ai decisions", () => {
    expect(() => validateFindingResponse(baseValid())).not.toThrow();
  });

  // W65 — ABSENT is now valid: aiOnPlan owns planAssessmentRows and the core no longer narrates it.
  // Present-but-wrong is still rejected, which is what the next two cases cover.
  it("accepts an absent planAssessmentRows, since the aiOnPlan leaf writes it", () => {
    const r = baseValid();
    (r as { planAssessmentRows?: unknown }).planAssessmentRows = undefined;
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("still rejects a planAssessmentRows that is present but not an array", () => {
    const r = baseValid();
    (r as { planAssessmentRows?: unknown }).planAssessmentRows = "nope";
    expect(() => validateFindingResponse(r)).toThrow(/planAssessmentRows missing or not an array/);
  });

  it("rejects a planAssessmentRows entry with an empty assessment", () => {
    const r = baseValid();
    r.planAssessmentRows = [{ action: "Continue statin", assessment: "" }];
    expect(() => validateFindingResponse(r)).toThrow(/assessment missing/);
  });

  it("accepts an empty planAssessment (patient gave no Patient Plan to assess)", () => {
    const r = baseValid();
    r.planAssessment = "";
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("accepts a short planAssessment (field lengths are not validated)", () => {
    const r = baseValid();
    r.planAssessment = "Short.";
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("rejects an empty finalThoughts (the whole-report reflection is always required)", () => {
    const r = baseValid();
    r.finalThoughts = "";
    expect(() => validateFindingResponse(r)).toThrow(/finalThoughts missing/);
  });

  it("accepts an empty ai array (the Finding may not motivate any Rx beyond patient suggestions)", () => {
    const r = baseValid();
    r.decisions.ai = [];
    r.doctorConversation.pop(); // remove the AI consideration dc entry
    r.treatmentGroups = []; // no AI items left to place
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("accepts an empty patient array (patient may have no decisions configured)", () => {
    const r = baseValid();
    r.decisions.patient = [];
    // remove the TRT dc entry (which corresponded to the patient decision)
    r.doctorConversation = r.doctorConversation.filter((g) => g.group !== "TRT");
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  // W67 — this used to REJECT, costing a full Opus regeneration (a real run spent one of its six
  // attempts here). It now merges: the duplicate is what crashed the PDF cover, and merging removes
  // it just as surely as rejecting did, without the $5. The union is what makes that safe — no marker
  // may be dropped, which is the assertion that would fail if the repair ever became lossy.
  it("merges a duplicate healthMarkers.recommended group, keeping every marker (the PDF cover-page crash bug)", () => {
    const r = baseValid();
    const before = r.healthMarkers.recommended.find((g) => g.group === "Cardiovascular Risk")!.markers.length;
    r.healthMarkers.recommended.push({
      group: "Cardiovascular Risk",
      markers: [{ name: "Hematocrit", rationale: "misfit dropped into a repeat group" }],
    });
    expect(() => validateFindingResponse(r)).not.toThrow();
    const groups = r.healthMarkers.recommended.map((g) => g.group);
    expect(groups).toEqual([...new Set(groups)]);
    const merged = r.healthMarkers.recommended.find((g) => g.group === "Cardiovascular Risk")!;
    expect(merged.markers).toHaveLength(before + 1);
    expect(merged.markers.some((m) => m.name === "Hematocrit")).toBe(true);
  });

  // The other half of the same W67 change: a near-match on a decision band is a transcription slip and
  // is repaired to the canonical label; an unrelated name is still a hard reject, because that is the
  // case where questions would be filed under the wrong decision.
  // W67 — assembleFinding silently .filter()ed an items-empty group out, so the model's mistake
  // vanished rather than being corrected. Checked inside validate() so the correction loop can fix it.
  it("rejects a dataRequisition group with no items", () => {
    const r = baseValid();
    r.dataRequisition.push({ type: "Imaging", group: "Cardiovascular Risk", items: [] });
    expect(() => validateFindingResponse(r)).toThrow(/has no items/);
  });

  it("tolerates a TRUNCATED doctorConversation decision label and stamps the canonical one", () => {
    const r = baseValid();
    const dc = r.doctorConversation.find((g) => g.group === "TRT")!;
    dc.group = "TR";
    expect(() => validateFindingResponse(r)).not.toThrow();
    expect(dc.group).toBe("TRT");
  });

  it("still rejects a doctorConversation decision label that names something else entirely", () => {
    const r = baseValid();
    r.doctorConversation.find((g) => g.group === "TRT")!.group = "Freediving";
    expect(() => validateFindingResponse(r)).toThrow(/does not match expected/);
  });

  it("rejects a duplicate treatment.item (the titration-split bug)", () => {
    const r = baseValid();
    r.treatment.push({
      item: "Ezetimibe 20 mg",
      assessment: rep("A second Ezetimibe row from a titration.", 6),
      group: "Cardiovascular Risk",
    });
    expect(() => validateFindingResponse(r)).toThrow(/duplicates a prior entry by drug name/);
  });

  it("accepts ai restating a patient decision (AI Hypothesis is the collective set)", () => {
    const r = baseValid();
    r.decisions.ai.push(decisionFixture("TRT", "the collective set may restate a patient item"));
    // dc gains the matching trailing AI entry (one per ai decision, in order).
    r.doctorConversation.push({ group: "TRT", questions: ["A second TRT entry."] });
    r.treatmentGroups.push({ system: "Hormonal / Endocrine", topic: "Androgen support", patient: [], ai: ["TRT"] }); // place the new ai item
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("rejects doctorConversation length mismatch (must be disease + patient + ai)", () => {
    const r = baseValid();
    r.doctorConversation.pop();
    expect(() => validateFindingResponse(r)).toThrow(/one entry per disease group \+ one per patient decision \+ one per AI consideration/);
  });

  it("rejects doctorConversation that does not align with the disease/patient/ai order", () => {
    const r = baseValid();
    const swap = r.doctorConversation[0];
    r.doctorConversation[0] = r.doctorConversation[1];
    r.doctorConversation[1] = swap;
    expect(() => validateFindingResponse(r)).toThrow(/does not match expected/);
  });

  it("rejects missing decisions object", () => {
    const r = baseValid();
    (r as any).decisions = undefined;
    expect(() => validateFindingResponse(r as any)).toThrow(/decisions/);
  });

  it("rejects decisions as a legacy array (the pre-2026-06-05 shape)", () => {
    const r = baseValid();
    (r as any).decisions = [decisionFixture("TRT", "improved free T")];
    expect(() => validateFindingResponse(r as any)).toThrow(/object with \{ patient, ai \}/);
  });

  it("rejects patient decision with too-few pros/cons/alternatives", () => {
    const r = baseValid();
    r.decisions.patient[0].pros = ["only one"];
    expect(() => validateFindingResponse(r)).toThrow(/pros must be an array of 2\+/);
  });

  it("rejects ai decision with an empty recommendation (presence, not length)", () => {
    const r = baseValid();
    r.decisions.ai[0].recommendation = "";
    expect(() => validateFindingResponse(r)).toThrow(/recommendation/);
  });

  it("accepts an empty clinicalSynthesis.conditioning (optional biological-age read)", () => {
    const r = baseValid();
    r.clinicalSynthesis.conditioning = "";
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("rejects an empty clinicalSynthesis.adverse (always required)", () => {
    const r = baseValid();
    r.clinicalSynthesis.adverse = "";
    expect(() => validateFindingResponse(r)).toThrow(/clinicalSynthesis\.adverse missing/);
  });

  it("rejects an empty clinicalSynthesis.favorable (always required)", () => {
    const r = baseValid();
    r.clinicalSynthesis.favorable = "";
    expect(() => validateFindingResponse(r)).toThrow(/clinicalSynthesis\.favorable missing/);
  });

  it("rejects a missing clinicalSynthesis object", () => {
    const r = baseValid();
    (r as any).clinicalSynthesis = undefined;
    expect(() => validateFindingResponse(r as any)).toThrow(/clinicalSynthesis missing/);
  });

  it("rejects a basis missing the clinicalSynthesis key", () => {
    const r = baseValid();
    delete (r.basis as any).clinicalSynthesis;
    expect(() => validateFindingResponse(r as any)).toThrow(/basis\.clinicalSynthesis/);
  });

  it("accepts criticalRatios with open-ended (single-bound) ranges", () => {
    const r = baseValid();
    delete (r.criticalRatios[0] as any).generalLow;
    delete (r.criticalRatios[0] as any).personalizedLow;
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("rejects fewer than 2 criticalRatios", () => {
    const r = baseValid();
    r.criticalRatios = r.criticalRatios.slice(0, 1);
    expect(() => validateFindingResponse(r)).toThrow(/criticalRatios must be an array of at least 2/);
  });

  it("rejects a criticalRatios entry missing a component marker", () => {
    const r = baseValid();
    r.criticalRatios[0].numerator = "";
    expect(() => validateFindingResponse(r)).toThrow(/criticalRatios\[0\]\.numerator missing/);
  });

  it("rejects a non-numeric criticalRatios bound", () => {
    const r = baseValid();
    (r.criticalRatios[0] as any).personalizedHigh = "1.5";
    expect(() => validateFindingResponse(r)).toThrow(/criticalRatios\[0\]\.personalizedHigh must be a number/);
  });

  it("rejects a basis missing the criticalRatios key", () => {
    const r = baseValid();
    delete (r.basis as any).criticalRatios;
    expect(() => validateFindingResponse(r as any)).toThrow(/basis\.criticalRatios/);
  });

  it("rejects an empty progression.latest (presence, not length)", () => {
    const r = baseValid();
    r.progression.latest = "";
    expect(() => validateFindingResponse(r)).toThrow(/progression.latest/);
  });

  it("rejects fewer than 4 disease entries", () => {
    const r = baseValid();
    r.disease = r.disease.slice(0, 3);
    expect(() => validateFindingResponse(r)).toThrow(/disease.*fewer than 4/);
  });

  it("rejects empty healthMarkers.recommended", () => {
    const r = baseValid();
    r.healthMarkers.recommended = [];
    expect(() => validateFindingResponse(r)).toThrow(/healthMarkers.recommended.*empty/);
  });

  it("rejects missing basis object", () => {
    const r = baseValid();
    (r as any).basis = undefined;
    expect(() => validateFindingResponse(r as any)).toThrow(/basis missing/);
  });

  it("rejects basis with a missing key (every section must carry a basis line)", () => {
    const r = baseValid();
    delete (r.basis as any).possibleFindings;
    expect(() => validateFindingResponse(r as any)).toThrow(/basis\.possibleFindings/);
  });

  it("rejects basis with an empty value (presence, not length)", () => {
    const r = baseValid();
    r.basis.aiFindings = "";
    expect(() => validateFindingResponse(r)).toThrow(/basis\.aiFindings/);
  });

  it("accepts up to 12 AI considerations (breadth for a patient with many studies)", () => {
    const r = baseValid();
    while (r.decisions.ai.length < 12) {
      const i = r.decisions.ai.length;
      r.decisions.ai.push(decisionFixture(`Extra-${i}`, `purpose ${i}`));
      r.doctorConversation.push({ group: `Extra-${i}`, questions: ["A question here."] });
      r.treatmentGroups.push({ system: "Cardiovascular Risk", topic: `Extra-${i}`, patient: [], ai: [`Extra-${i}`] });
    }
    expect(() => validateFindingResponse(r)).not.toThrow();
  });

  it("rejects more than 12 AI considerations", () => {
    const r = baseValid();
    while (r.decisions.ai.length <= 12) {
      const i = r.decisions.ai.length;
      r.decisions.ai.push(decisionFixture(`Extra-${i}`, `purpose ${i}`));
      r.doctorConversation.push({ group: `Extra-${i}`, questions: ["A question here."] });
    }
    expect(() => validateFindingResponse(r)).toThrow(/decisions.ai has more than 12/);
  });

  // W21 — treatmentGroups partition.
  it("rejects a treatmentGroups entry with no topic", () => {
    const r = baseValid();
    r.treatmentGroups[0].topic = "";
    expect(() => validateFindingResponse(r)).toThrow(/treatmentGroups\[0\]\.topic missing/);
  });

  it("rejects an ai ref that matches no decisions.ai intervention", () => {
    const r = baseValid();
    r.treatmentGroups[0].ai = ["Nonexistent drug"];
    expect(() => validateFindingResponse(r)).toThrow(/matches no decisions\.ai intervention/);
  });

  it("rejects a decisions.ai intervention left out of every group (no silent drop)", () => {
    const r = baseValid();
    r.treatmentGroups = [{ system: "Cardiovascular Risk", topic: "Empty", patient: ["TRT"], ai: [] }];
    expect(() => validateFindingResponse(r)).toThrow(/is not placed in any treatmentGroups group/);
  });

  it("rejects an ai ref appearing in more than one group", () => {
    const r = baseValid();
    r.treatmentGroups.push({ system: "Cardiovascular Risk", topic: "Dup", patient: [], ai: ["Statin or PCSK9 inhibitor"] });
    expect(() => validateFindingResponse(r)).toThrow(/appears in more than one group/);
  });

  it("rejects a group with neither patient nor ai items", () => {
    const r = baseValid();
    r.treatmentGroups.push({ system: "Cardiovascular Risk", topic: "Empty", patient: [], ai: [] });
    expect(() => validateFindingResponse(r)).toThrow(/has neither patient nor ai items/);
  });

  it("rejects a studyResults entry with no group (W25)", () => {
    const r = baseValid();
    (r.studyResults[0] as { group: string }).group = "";
    expect(() => validateFindingResponse(r)).toThrow(/studyResults\[0\].*group missing/);
  });

  it("rejects a studyResults group that is not one of the disease groups (W25)", () => {
    const r = baseValid();
    r.studyResults[0].group = "Renal";
    expect(() => validateFindingResponse(r)).toThrow(/studyResults\[0\].*is not one of the disease groups/);
  });

  it("rejects a treatment entry with no group (W25)", () => {
    const r = baseValid();
    (r.treatment[0] as { group: string }).group = "";
    expect(() => validateFindingResponse(r)).toThrow(/treatment\[0\].*group missing/);
  });

  it("rejects a treatment group that is not one of the disease groups (W25)", () => {
    const r = baseValid();
    r.treatment[0].group = "Renal";
    expect(() => validateFindingResponse(r)).toThrow(/treatment\[0\].*is not one of the disease groups/);
  });

  it("rejects a dataRequisition entry with no group (W27)", () => {
    const r = baseValid();
    (r.dataRequisition[0] as { group: string }).group = "";
    expect(() => validateFindingResponse(r)).toThrow(/dataRequisition\[0\].*group missing/);
  });

  it("rejects a dataRequisition group that is not one of the disease groups (W27)", () => {
    const r = baseValid();
    r.dataRequisition[0].group = "Nephrology";
    expect(() => validateFindingResponse(r)).toThrow(/dataRequisition\[0\].*is not one of the disease groups/);
  });

  it("rejects a definitions entry with no group (M96 Phase 9)", () => {
    const r = baseValid();
    (r.definitions[0] as { group: string }).group = "";
    expect(() => validateFindingResponse(r)).toThrow(/definitions\[0\].*group missing/);
  });

  it("rejects a definitions group that is not one of the disease groups (M96 Phase 9)", () => {
    const r = baseValid();
    r.definitions[0].group = "Renal";
    expect(() => validateFindingResponse(r)).toThrow(/definitions\[0\].*is not one of the disease groups/);
  });

  it("rejects a treatmentGroups entry with no system", () => {
    const r = baseValid();
    (r.treatmentGroups[0] as { system: string }).system = "";
    expect(() => validateFindingResponse(r)).toThrow(/treatmentGroups\[0\].*system missing/);
  });

  it("rejects a system that is not one of the disease groups", () => {
    const r = baseValid();
    r.treatmentGroups[0].system = "Renal";
    expect(() => validateFindingResponse(r)).toThrow(/is not one of the disease groups/);
  });

  it("rejects treatmentGroups whose systems break disease order", () => {
    const r = baseValid();
    r.decisions.ai.push(decisionFixture("Losartan", "aortic protection"));
    r.doctorConversation.push({ group: "Losartan", questions: ["Which ARB?"] });
    // Hormonal (idx 2) before Cardiovascular (idx 0) — out of disease order.
    r.treatmentGroups = [
      { system: "Hormonal / Endocrine", topic: "ARB", patient: [], ai: ["Losartan"] },
      { system: "Cardiovascular Risk", topic: "Lipid-lowering", patient: ["TRT"], ai: ["Statin or PCSK9 inhibitor"] },
    ];
    expect(() => validateFindingResponse(r)).toThrow(/out of disease order/);
  });

  // A leaf-owned basis key is NOT the core's to narrate any more — the section is written by that
  // node's own leaf-regen spec, and mergeLeafResult stamps its basis from DagNode.basis. Requiring it
  // here would fail the core response for a section it no longer produces.
  it("accepts a response with no basis entry for a leaf-owned section", () => {
    for (const key of LEAF_OWNED_BASIS_KEYS) {
      const r = baseValid();
      delete (r.basis as Record<string, string>)[key];
      expect(() => validateFindingResponse(r)).not.toThrow();
    }
  });

  it("still rejects a missing basis key the core does own", () => {
    const r = baseValid();
    delete (r.basis as Record<string, string>).clinicalSynthesis;
    expect(() => validateFindingResponse(r)).toThrow(/basis\.clinicalSynthesis missing/);
  });
});

// The prompt presents a Patient Plan action as its (quoted) text; the validator matches refs against
// that text VERBATIM. These tests pin that contract: a clean action ref passes; the "date: action"
// slip that broke a real regen is rejected — which is what lets the retry-feedback loop fix it
// instead of silently shipping mismatched data. (Would have caught the W24 date-prefix bug for free.)
describe("prompt↔validator verbatim-ref contract", () => {
  const PLAN_ACTION = "Continue Tirzepatide 6mg/week";
  const inputs = { patient: ["TRT", PLAN_ACTION], planActions: [PLAN_ACTION] };

  function withPlan() {
    const r = baseValid();
    r.planAssessmentRows = [{ action: PLAN_ACTION, assessment: "Reasonable maintenance dose." }];
    r.treatmentGroups[0].patient = ["TRT", PLAN_ACTION];
    return r;
  }

  it("accepts refs that copy the plan Action text verbatim", () => {
    expect(() => validateFindingWithInputs(withPlan(), inputs)).not.toThrow();
  });

  it("rejects a planAssessmentRows action carrying the timing prefix (the regen slip)", () => {
    const r = withPlan();
    r.planAssessmentRows = [{ action: `2026-06-01: ${PLAN_ACTION}`, assessment: "x." }];
    expect(() => validateFindingWithInputs(r, inputs)).toThrow(/matches no Patient Plan action/);
  });

  it("rejects a treatmentGroups plan ref carrying the timing prefix", () => {
    const r = withPlan();
    r.treatmentGroups[0].patient = ["TRT", `2026-06-01: ${PLAN_ACTION}`];
    expect(() => validateFindingWithInputs(r, inputs)).toThrow(/matches no patient hypothesis or plan action/);
  });
});

// A note has no short label the model could echo back, so results are zipped to notes POSITIONALLY.
// That makes the count the only thing standing between a mismatched answer and a stored clinical
// record attributing one note's answer to a different note. It is the example README.md leads with,
// and until now nothing exercised it.
describe("noteResults pairs to notes by position, so the count is the contract", () => {
  const inputs = { patient: ["TRT"], noteIds: ["note-1"] };

  it("accepts exactly one result per populated note", () => {
    expect(() => validateFindingWithInputs(baseValid(), inputs)).not.toThrow();
  });

  it("rejects a second result the notes cannot account for", () => {
    const r = baseValid();
    r.noteResults = [...r.noteResults, { result: rep("Extra note sentence.", 6), group: "Cardiovascular Risk" }];
    expect(() => validateFindingWithInputs(r, inputs)).toThrow(/exactly one entry per populated Note.*expected 1, got 2/);
  });

  it("rejects a missing result rather than pairing the survivors by luck", () => {
    const r = baseValid();
    r.noteResults = [];
    expect(() => validateFindingWithInputs(r, { patient: ["TRT"], noteIds: ["note-1", "note-2"] }))
      .toThrow(/exactly one entry per populated Note.*expected 2, got 0/);
  });
});

// W64 — validate() has always accepted `basis` in either shape (an array of {key,text}, or the
// object the vault stores), but assembleFinding only ever iterated the array. A model emitting the
// object form therefore passed validation and then threw on a non-iterable during assembly. The
// declared type named only the array, which is why nothing caught it; widening it to the union the
// validator actually permits surfaced this.
describe("basis accepts both shapes end to end", () => {
  const meta = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    inputsHash: "h",
    nodeHashes: {},
    generatedBy: { mode: "prod" as const, model: "m" },
    noteIds: ["n1"],
    promptVersions: { core: "v1" },
  };

  it("assembles from the ARRAY form", () => {
    const r = baseValid();
    const asArray = Object.entries(r.basis).map(([key, text]) => ({ key, text: text as string }));
    const out = assembleFinding({ ...r, basis: asArray } as never, meta);
    expect(out.basis!.patientAssessment).toBe("Based on user input.");
  });

  it("assembles from the OBJECT form — the shape the vault actually stores", () => {
    const out = assembleFinding(baseValid() as never, meta);
    expect(out.basis!.patientAssessment).toBe("Based on user input.");
  });
});

// W65 — the retry loop discarded its reason into the correction text and told the caller nothing,
// so three full generations looked like one long hang. This pins the reporting, not the retrying.
describe("generateFindingResponse reports why each attempt was rejected", () => {
  it("calls onAttemptFailed with the attempt number and the validation message", async () => {
    const { generateFindingResponse } = await import("@pablotech/akesi-pil/finding-generate");
    const bad = { content: [{ type: "text", text: '{"progression":{}}' }], usage: {} };
    const anthropic = {
      messages: { stream: () => ({ finalMessage: async () => bad }) },
    } as unknown as Parameters<typeof generateFindingResponse>[0];

    const seen: [number, string][] = [];
    await expect(
      generateFindingResponse(anthropic, { displayName: "P", results: [], watchlist: [] } as never, "m", undefined, (a, r) =>
        seen.push([a, r]),
      ),
    ).rejects.toThrow();

    // One report per rejected attempt, numbered from 1, each carrying a real reason.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0][0]).toBe(1);
    expect(seen[0][1]).toMatch(/\w/);
    expect(seen.map(([a]) => a)).toEqual(seen.map((_, i) => i + 1));
  });

  // W67 — the whack-a-mole fix. A real run burned all six attempts: 4 failed on a duplicate marker
  // group, 5 on a bad dataRequisition group, 6 on a doctorConversation label. Each correction said
  // "fix exactly this problem", so the model fixed the named one and broke another, never once seeing
  // the accumulated list. Every prior rejection now goes back in.
  it("carries EVERY prior rejection into the next correction, not just the latest", async () => {
    const { generateFindingResponse } = await import("@pablotech/akesi-pil/finding-generate");
    // A different failure each attempt, so a correction carrying only the latest would show one entry.
    const bodies = ['{"progression":{}}', "not json at all", '{"progression":{},"disease":[]}'];
    const sent: string[] = [];
    let n = 0;
    const anthropic = {
      messages: {
        stream: (req: { messages: { content: string }[] }) => {
          sent.push(req.messages[0].content);
          const text = bodies[Math.min(n++, bodies.length - 1)];
          return { finalMessage: async () => ({ content: [{ type: "text", text }], usage: {} }) };
        },
      },
    } as unknown as Parameters<typeof generateFindingResponse>[0];

    await expect(
      generateFindingResponse(anthropic, { displayName: "P", results: [], watchlist: [] } as never, "m"),
    ).rejects.toThrow();

    expect(sent).toHaveLength(3); // MAX_ATTEMPTS — three whole Opus generations is the ceiling now
    expect(sent[0]).not.toContain("CORRECTIONS");
    expect(sent[1]).toContain("1 previous attempt(s) were REJECTED");
    // The third request must carry BOTH earlier reasons, numbered — this is the assertion that fails
    // if the loop goes back to overwriting `correction` with the latest message.
    expect(sent[2]).toContain("2 previous attempt(s) were REJECTED");
    expect(sent[2]).toMatch(/1\. /);
    expect(sent[2]).toMatch(/2\. /);
  });
});
