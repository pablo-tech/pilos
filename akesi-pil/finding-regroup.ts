// The treatmentGroups finding node, extracted so a host web endpoint and a host
// CLI leaf-regen can regenerate just this leaf without the ~$5 monolithic call. This is the
// single source of truth for the prompt, the tool schema, the validator, and the id→text resolver.
//
// Two structural robustness fixes land here, where the node is small enough for both to
// be practical (the monolith's combined schema outgrew the grammar ceiling):
//   #1 id-refs — every input carries a short stable id (S#/P#/A#/AI#); the model references the id,
//      never the free text, so the "ref must match a presented string exactly" failure class is gone.
//   #3 tool-schema — the output is emitted through a JSON-schema tool call, not hand-rolled JSON in a
//      text block, so escaping/format failures largely disappear.
// Isomorphic: no node:/SDK imports, so both a Pages Function and the browser can build inputs, validate,
// and resolve. The Anthropic call itself lives in each caller (Function / CLI), which supply prompt+tool.

import type { Client, TreatmentGroup } from "./types";
import { treatmentsOf } from "./treatment-normalize";
import { bucketOf, treatmentLabel, todayISODate } from "./treatment-bucket";

export interface RegroupItem {
  id: string;
  text: string;
  purpose?: string;
}
export interface RegroupInputs {
  systems: { id: string; name: string }[]; // S# — disease[].group, in order
  patientHypotheses: RegroupItem[]; // P# — factors.decisions
  planActions: RegroupItem[]; // A# — planned (future-dated) treatments
  aiInterventions: RegroupItem[]; // AI# — finding.decisions.ai
}

// id-ref'd group as the model emits it (before resolving ids back to text).
export interface GroupRef {
  system: string; // an S# id
  topic: string;
  patient: string[]; // P#/A# ids
  ai: string[]; // AI# ids
}
export interface RegroupResponse {
  groups: GroupRef[];
}

export function buildRegroupInputs(client: Client): RegroupInputs {
  const today = todayISODate();
  return {
    systems: (client.finding?.disease ?? []).map((d, i) => ({ id: `S${i + 1}`, name: d.group.trim() })),
    patientHypotheses: (client.factors?.decisions ?? []).map((d, i) => ({ id: `P${i + 1}`, text: d.intervention.trim(), purpose: d.purpose })),
    planActions: treatmentsOf(client)
      .filter((t) => bucketOf(t, today) === "planned")
      .map((t, i) => ({ id: `A${i + 1}`, text: treatmentLabel(t) })),
    aiInterventions: (client.finding?.decisions?.ai ?? []).map((d, i) => ({ id: `AI${i + 1}`, text: d.intervention.trim(), purpose: d.purpose })),
  };
}

export const REGROUP_SYSTEM_PROMPT =
  "You partition a patient's proposed treatments into clinically-coherent clusters — the patient's " +
  "view beside the AI's — so a doctor can see where they agree, differ, or have no counterpart. You " +
  "reference every item by its short id (S#/P#/A#/AI#), never by copying its text. Emit the result " +
  "ONLY through the emit_treatment_groups tool.";

export function regroupUserPrompt(inputs: RegroupInputs): string {
  const sec: string[] = [];
  sec.push("Body systems (reference by id; a group's `system` is exactly one of these ids), in order:");
  for (const s of inputs.systems) sec.push(`  ${s.id}: ${s.name}`);
  sec.push("Patient hypotheses — interventions the patient is weighing (reference in `patient` by id):");
  for (const p of inputs.patientHypotheses) sec.push(`  ${p.id}: ${p.text}${p.purpose ? ` — ${p.purpose}` : ""}`);
  sec.push("Patient Plan actions — committed steps (reference in `patient` by id; ignore any timing):");
  for (const a of inputs.planActions) sec.push(`  ${a.id}: ${a.text}`);
  sec.push("AI interventions — the AI's proposed set (reference in `ai` by id):");
  for (const ai of inputs.aiInterventions) sec.push(`  ${ai.id}: ${ai.text}${ai.purpose ? ` — ${ai.purpose}` : ""}`);
  sec.push(
    [
      "Rules:",
      "- Each group is { system, topic, patient, ai }: an S# id, a drug-class label, patient ids on the",
      "  left, ai ids on the right.",
      "- topic is the DRUG CLASS (≤6 words: \"Lipid-lowering\", \"ARB\", \"GLP-1 / incretin\", \"Androgen",
      "  support\", \"Methyl donors\"), NOT a hoped-for benefit. Cluster items sharing a class together;",
      "  never split a class across groups by benefit.",
      "- HARD COVERAGE: every P#, every A#, and every AI# appears in EXACTLY ONE group. Never invent an id.",
      "  Many-to-many is fine — a patient item may sit with several ai items and vice versa. Fold a",
      "  \"Continue X\" plan action into the group of the therapy it continues.",
      "- system is the body system the therapy primarily acts on.",
      "- ORDER groups by their system id in the order listed above; all groups sharing a system MUST be",
      "  contiguous. A group may be patient-only (empty ai) or ai-only (empty patient), but not both empty.",
    ].join("\n"),
  );
  return sec.join("\n\n");
}

export const TREATMENT_GROUPS_TOOL = {
  name: "emit_treatment_groups",
  description: "Emit the partition of proposed treatments into system/drug-class clusters, referencing every item by its id.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        description: "The clusters, ordered by system id, systems contiguous.",
        items: {
          type: "object",
          properties: {
            system: { type: "string", description: "a body-system id (S1, S2, …)" },
            topic: { type: "string", description: "the drug-class label (≤6 words)" },
            patient: { type: "array", items: { type: "string" }, description: "patient item ids (P#/A#); may be empty" },
            ai: { type: "array", items: { type: "string" }, description: "AI intervention ids (AI#); may be empty" },
          },
          required: ["system", "topic", "patient", "ai"],
        },
      },
    },
    required: ["groups"],
  },
};

// Id-based coverage / order / contiguity checks — the verbatim-match logic from the monolith
// (claude-finding.ts) ported to ids, so nothing depends on the model echoing free text exactly.
export function validateRegroup(resp: unknown, inputs: RegroupInputs): void {
  const r = resp as RegroupResponse;
  if (!r || !Array.isArray(r.groups)) throw new Error("groups missing or not an array");

  const systemOrder = inputs.systems.map((s) => s.id);
  const patientIds = new Set([...inputs.patientHypotheses, ...inputs.planActions].map((x) => x.id));
  const aiIds = new Set(inputs.aiInterventions.map((x) => x.id));
  const seenPatient = new Set<string>();
  const seenAi = new Set<string>();
  let prevSysIdx = -1;
  const systemsSeen = new Set<string>();

  for (const [i, g] of r.groups.entries()) {
    if (!g || typeof g.topic !== "string" || g.topic.trim().length === 0) throw new Error(`groups[${i}].topic missing`);
    if (typeof g.system !== "string") throw new Error(`groups[${i}] (${g.topic}) system missing`);
    const sysIdx = systemOrder.indexOf(g.system);
    if (sysIdx < 0) throw new Error(`groups[${i}] (${g.topic}) system "${g.system}" is not one of the system ids`);
    if (sysIdx < prevSysIdx) throw new Error(`groups[${i}] (${g.topic}) system "${g.system}" is out of order`);
    if (sysIdx !== prevSysIdx && systemsSeen.has(g.system)) {
      throw new Error(`groups system "${g.system}" is not contiguous — all groups of a system must be adjacent`);
    }
    prevSysIdx = sysIdx;
    systemsSeen.add(g.system);
    if (!Array.isArray(g.patient) || !Array.isArray(g.ai)) throw new Error(`groups[${i}] (${g.topic}) patient and ai must be arrays`);
    if (g.patient.length === 0 && g.ai.length === 0) throw new Error(`groups[${i}] (${g.topic}) has neither patient nor ai items`);
    for (const ref of g.ai) {
      if (!aiIds.has(ref)) throw new Error(`groups[${i}] (${g.topic}) ai ref "${ref}" is not an AI# id`);
      if (seenAi.has(ref)) throw new Error(`ai ref "${ref}" appears in more than one group`);
      seenAi.add(ref);
    }
    for (const ref of g.patient) {
      if (!patientIds.has(ref)) throw new Error(`groups[${i}] (${g.topic}) patient ref "${ref}" is not a P#/A# id`);
      if (seenPatient.has(ref)) throw new Error(`patient ref "${ref}" appears in more than one group`);
      seenPatient.add(ref);
    }
  }
  for (const id of aiIds) if (!seenAi.has(id)) throw new Error(`AI intervention ${id} is not placed in any group`);
  for (const id of patientIds) if (!seenPatient.has(id)) throw new Error(`patient item ${id} is not placed in any group`);
}

// Resolve id-refs back to the stored TreatmentGroup[] shape (verbatim text), which the render-side
// resolver (treatment-groups.ts) and FutureTreatment already consume. Assumes validateRegroup passed.
export function resolveRegroup(resp: RegroupResponse, inputs: RegroupInputs): TreatmentGroup[] {
  const sysName = new Map(inputs.systems.map((s) => [s.id, s.name]));
  const patientText = new Map([...inputs.patientHypotheses, ...inputs.planActions].map((x) => [x.id, x.text]));
  const aiText = new Map(inputs.aiInterventions.map((x) => [x.id, x.text]));
  return resp.groups.map((g) => ({
    system: sysName.get(g.system) ?? g.system,
    topic: g.topic.trim(),
    patient: g.patient.map((id) => patientText.get(id) ?? id),
    ai: g.ai.map((id) => aiText.get(id) ?? id),
  }));
}
