

export interface MarkerResult {
  marker: string;
  group: string;
  source: string;
  date: string;
  value: number;
  unit: string;
  // Display override for semi-quantitative results whose `value` is a stand-in
  // for sorting/charting (antibody titers: value 80 → valueText "1:80"). When
  // present, render this verbatim instead of `value`/`unit`.
  valueText?: string;
  ref?: { low?: number; high?: number };
  // Provenance: id of the source file (SourceRecord.id) this reading came from —
  // a lab xlsx, a DEXA/scale export, or an imaging report. Absent for readings
  // ingested before provenance tracking.
  sourceId?: string;
  // Backfilled from a LATER report's "vs prior" narrative (e.g. the 2026 echo
  // states the 2021 mean gradient was 10), not directly measured. A low-priority
  // placeholder: a directly-measured reading at the same marker|date always
  // replaces it. `sourceId` points at the report that stated the comparison.
  fromComparison?: true;
}

export type InferenceMode = "dev" | "prod";

export interface GeneratedBy {
  mode: InferenceMode;
  model: string;
}

export interface PersonalizedRange {
  low?: number;
  high?: number;
  unit: string;
  // Plain-language "what this marker is / what it reflects" — a short definition shown
  // contextually in the marker chart, independent of the range rationale below.
  meaning?: string;
  explanation: string;
  explanationImperial?: string;
  // General population/guideline range based ONLY on age, gender, and height —
  // the baseline the personalized range is shifted from. Same unit/scale as low/high.
  generalLow?: number;
  generalHigh?: number;
  generalExplanation?: string;
  generatedAt: string;
  factorsHash: string;
  generatedBy?: GeneratedBy;
}

export type TreatmentKind = "drug" | "supplement" | "behavior";

// One attached photo/document, stored raw at `key` (a host's object store, mirroring
// PendingUpload.file's "<sha8>-<safeName>" shape) and referenced from whichever leaf item it's
// attached to (NoteEntry, TreatmentItem, DecisionEntry, StudyEntry, AllergyEntry,
// FamilyHistoryEntry, DiseaseEntry, ChatTurn).
export interface Attachment {
  key: string;
  name: string;
  mediaType: string;
  bytes: number;
  addedAt: string;
  // METADATA ONLY about a document whose contents have been read (document-read.ts). The text
  // itself deliberately lives outside the vault, in an R2 sidecar keyed by this attachment's own
  // content-addressed key — a long PDF's transcription would otherwise bloat a blob that is
  // re-encrypted and rewritten on every unrelated edit. This is what the UI shows and what tells a
  // consumer there is a sidecar worth fetching. Absent on an image, and on any document attached
  // before extraction existed.
  extracted?: {
    at: string;
    chars: number;
    /** document-read.ts's own label for what the document is, e.g. "Radiology report". */
    kind?: string;
    /** Set when extraction was attempted and failed, so the UI can say so instead of staying blank. */
    error?: string;
  };
}

// One ingredient off a product's own label, with the amount PER SERVING as printed. These are label
// facts about the product, deliberately kept apart from the patient's own dose entry
// (doseAmount/doseUnit/doseFrequency below): "100mcg Selenium" is what one capsule contains, not how
// much the patient takes. Nothing here may ever reach formatDose() or treatmentLabel() — that label
// is the cross-system matching key for stored Findings, so a label amount leaking into it would
// silently unmatch every existing reference.
export interface Ingredient {
  name: string;
  amount?: number;
  unit?: string;
  // The chemical form or source as printed — "L-Selenomethionine", "20% Coleus Forskohlii Extract".
  form?: string;
}

// The label's OWN suggested serving/administration — a LABEL FACT like Ingredient, extracted by
// the extraction pipeline, never typed by the patient. Medicine-scope, fans across dose rows like description/
// ingredients/links. `unit` uses the same vocabulary as TreatmentItem.doseUnit, because a new
// record's doseUnit gets locked to this value. `unitsPerServing` exists because Ingredient.amount
// is per SERVING, and a serving is not always one countable unit ("Serving Size: 2 softgels").
export interface Administration {
  unit: string;
  unitsPerServing: number;
  suggestedUnits: number;
  suggestedFrequency: DoseFrequency;
  // The package's OWN total count, as printed (e.g. a bottle of 60 capsules) — a different fact
  // from `suggestedUnits` (the per-administration recommended count) and not used in the daily-
  // total arithmetic; captured because it's on the label and otherwise lost. Absent when the
  // source doesn't state a total (a torn label, a partial photo, pasted text with no count).
  containerQuantity?: number;
}

// An external reference for a product — a third-party COA, a spec sheet. The URL is stored and shown
// and handed to the model as a citable reference; nothing fetches it (see the milestone's
// out-of-scope note: an outbound fetch to a user-supplied URL from the PHI-handling Function is an
// SSRF and prompt-injection surface). `url` is validated http/https at the boundary — see
// treatment-product.ts.
export interface ProductLink {
  label: string;
  url: string;
}

// A single heterogeneous intervention: a drug/supplement (with a dose) or a behavior
// (no dose). Its temporal bucket (past / ongoing / planned) is DERIVED from start/end
// (treatment-bucket.ts), never stored. `start`/`end` are ISO `YYYY-MM` (or `YYYY`);
// an empty `start` means "taking it, date unknown" → ongoing.
export type DoseFrequency = "day" | "week" | "month" | "as needed";

export interface TreatmentItem {
  id: string;
  pinned?: boolean;
  name: string;
  // M104 — superseded by doseAmount/doseUnit/doseFrequency (below) for anything entered through the
  // edit form; kept as the display/matching fallback for un-migrated records (see formatDose() in
  // treatment-bucket.ts, and whatever one-time conversion a host runs).
  dose?: string;
  doseAmount?: number;
  doseUnit?: string;
  doseFrequency?: DoseFrequency;
  kind?: TreatmentKind;
  start: string;
  end?: string;
  reason?: string;
  timingPeriod?: "AM" | "PM";
  // Superseded by `attachments` (below); kept read-only for un-migrated vaults, same
  // shim pattern as LegacyFactors. New writes always use `attachments`; see a host's
  // attachment-store fold function.
  images?: string[];
  attachments?: Attachment[];
  // The PRODUCT, not this dose period — what the thing is, what is in it, where its paperwork lives.
  // Medicine-level like name/reason/kind (and now attachments): a medicine-scope save fans these
  // across every dose row, and the per-entry editor never shows them. For a formulated supplement
  // this is the entire clinical content — "Thyroid Support" names nothing on its own.
  description?: string;
  // The manufacturer/brand as printed — a label fact like description, same medicine-scope fan-out.
  maker?: string;
  ingredients?: Ingredient[];
  links?: ProductLink[];
  // The label's own suggested serving/administration — see Administration's own comment. Same
  // medicine-scope fan-out as description/ingredients/links above.
  administration?: Administration;
  // Provenance: set once, inside identifyFrom()'s success branch (a host-side UI component), when
  // name/kind/description/ingredients/links came from reading a photo or pasted text rather than
  // being typed by hand. One flag for the whole merge — identifyFrom() answers one
  // question, "what is this product," in one call — mirrors DiseaseEntry.sourceId/summary's
  // "absent for hand-entered" convention. Absent for a hand-entered treatment.
  extracted?: { via: "photo" | "text"; at: string };
  // The Attachment key(s) this extraction was read from — a subset of `attachments` (above), so a
  // later, unrelated manual Attach is never mistaken for the original raw capture. Meaningful only
  // when extracted?.via === "photo".
  rawCaptureAttachmentKeys?: string[];
  // The exact text pasted into "From text" that produced this extraction, kept verbatim so the
  // original raw source is always distinguishable from what the extraction pipeline inferred from
  // it. Meaningful only when extracted?.via === "text".
  rawCaptureText?: string;
}

// Pre-unification on-disk shapes, read ONLY by the load-shim (treatment-normalize.ts) to
// fold an un-migrated vault into `treatments`. Never written.
export interface LegacyTreatmentItem { drug?: string; dose?: string; since?: string }
export interface LegacyPlanEntry { action?: string; date?: string }
export interface LegacyFactors {
  medications?: LegacyTreatmentItem[];
  supplements?: LegacyTreatmentItem[];
  plan?: LegacyPlanEntry[];
}

export interface DiseaseEntry {
  id: string;
  pinned?: boolean;
  attachments?: Attachment[];
  date: string;
  diagnostic: string;
  // Up to ~3 sentences capturing the nature/metrics of the finding (e.g. CAC
  // score + per-vessel detail, valve morphology, steatosis grade/extent). Drives
  // the Finding alongside the terse `diagnostic`. Populated for imaging-extracted
  // diagnoses; absent for hand-entered ones.
  summary?: string;
  // Provenance: id of the source file (SourceRecord.id) when extracted from an
  // imported medical report. Absent for hand-entered diagnoses.
  sourceId?: string;
  // ICD code(s) (e.g. ["I25.10"]) from a report's coded header Diagnosis list.
  // A coarse coded comorbidity that a more-detailed finding already covers is
  // collapsed into that finding, so a row can carry more than one code. Absent
  // for plain study findings and hand-entered diagnoses.
  icdCodes?: string[];
}

// One ingested source file — a lab xlsx, a DEXA/scale export, or a narrative
// medical report PDF. The bytes live as a committed file at `file`; this record
// links the readings/diseases it produced (by `id` === their `sourceId`) back to
// the document, and is the content-hash dedup key for re-ingest.
export interface SourceRecord {
  id: string;          // sha256(bytes).slice(0,12) — also the entries' sourceId
  sha256: string;      // full content hash (dedup key)
  kind: "lab" | "dexa" | "scale" | "imaging";
  file: string;        // repo-relative path to the stored source file
  originalName: string;
  importedAt: string;
  model?: string;      // imaging only (the extraction model)
  mode?: string;       // imaging only
  studyType?: string;  // imaging only
  studyDate?: string;  // imaging only
  dateStart?: string;  // lab/dexa/scale — earliest reading date in the file
  dateEnd?: string;    // lab/dexa/scale — latest reading date
  extraction?: ImagingExtraction; // imaging only — cached LLM output for deterministic re-import
  diseaseCount?: number;
  markerCount?: number;
  readingCount?: number; // lab/dexa/scale
  // A report is the one AI-adjacent section that ALREADY had a real source record, so its pin
  // lives on the record itself rather than in the itemRegistry below. Pinning never edits the
  // report's content, only marks it an area of query for the next finding.
  pinned?: boolean;
}

// The cached output of a report extraction (mirrors the proposal shape a caller assembles;
// declared here so it can live in the vault).
export interface ImagingExtraction {
  studyType: string;
  diseases: { date: string; diagnostic: string; summary?: string; confidence: number }[];
  comorbidities?: { code: string; label: string; description?: string; confidence: number }[];
  priorComparisons?: { marker: string; priorValue: number; priorDate: string; currentValue: number; unit: string; confidence: number }[];
  markers: { marker: string; value: number; unit: string; date: string; group: string; confidence: number }[];
}

export interface DecisionEntry {
  id: string;
  pinned?: boolean;
  intervention: string;
  purpose: string;
  attachments?: Attachment[];
}

export interface AllergyEntry {
  id: string;
  pinned?: boolean;
  allergen: string;
  reaction: string;
  severity?: "mild" | "moderate" | "severe";
  dateNoted?: string;
  attachments?: Attachment[];
}

export interface FamilyHistoryEntry {
  id: string;
  pinned?: boolean;
  relation: string;
  condition: string;
  attachments?: Attachment[];
}

// M-annotate — a row from Chat/Markers/Reports/Study/Hypothesis attached to a to-be-created note,
// mirroring chat-threads.ts's ReferenceTurnData shape (permalink + preview) but with its own kind
// union (one member per source view) instead of ReferenceKind, since it seeds a note rather than a
// chat reference card and reference-resolver.ts already imports from this file (importing
// ReferenceKind back here would cycle).
// "treatment"/"note"/"allergy"/"family" added as Annotate went from covering a handful of leaf
// types to universal (every leaf action menu).
/**
 * A pointer to somewhere in the record, structurally.
 *
 * types.ts used to import a `Permalink` type from a host-side module for this one field, which
 * dragged the host app's UI ROUTING (its tab union, its section tables) into a type module meant to
 * be host-agnostic.
 *
 * `tab` is `string` here rather than a host's own tab union, and that widening is the whole mechanism:
 * a `Permalink` remains assignable to a `LeafRef`, so every writer is unchanged, while a reader that
 * genuinely needs the union narrows at its own boundary. The brain does not get an opinion about how
 * many tabs the app has.
 */
export interface LeafRef {
  client?: string;
  tab: string;
  section?: string;
  anchor?: string;
}

export interface NoteAttachment {
  kind: "chatTurn" | "marker" | "report" | "study" | "idea" | "group" | "treatment" | "note" | "allergy" | "family";
  permalink: LeafRef;
  preview: { title: string; subtitle?: string; tag: string };
}

export interface NoteEntry {
  id: string;
  pinned?: boolean;
  text: string;
  // A reference card pointing BACK at another leaf this note was created from (Chat/Markers/
  // Reports/etc — see NoteAttachment below), singular by construction (Annotate seeds exactly one).
  attachment?: NoteAttachment;
  // Photos/documents uploaded ONTO this note (unrelated to `attachment` above).
  attachments?: Attachment[];
}

export interface FindingDecisionEntry {
  intervention: string;
  purpose: string;
  pros: string[];
  cons: string[];
  alternatives: string[];
  recommendation: string;
}

export interface ClientFactors {
  diseases?: DiseaseEntry[];
  // The unified heterogeneous treatment list (drugs, supplements, behaviors),
  // each temporally bucketed by start/end. Supersedes the retired medications /
  // supplements / plan arrays; un-migrated vaults are folded via treatmentsOf().
  treatments?: TreatmentItem[];
  allergies?: AllergyEntry[];
  familyHistory?: FamilyHistoryEntry[];
  decisions?: DecisionEntry[];
  noteEntries?: NoteEntry[];
  pregnancy?: "none" | "pregnant" | "postpartum" | "menopause";
  athletic?: "sedentary" | "moderate" | "endurance";
  bmi?: number;
  height?: string;
  smoking?: "never" | "former" | "current";
  ethnicity?: string;
  goal?: string;
  focus?: string;
}

export interface StudyEntry {
  id: string;
  pinned?: boolean;
  focus: string;
  detail: string;
  attachments?: Attachment[];
}

export interface ClientStudy {
  // Named study tuples (e.g. focus "Selection", "Suspicion") rendered as rows in Pursued Study.
  entries?: StudyEntry[];
}

export interface FindingBasis {
  patientAssessment: string;
  patientProfile: string;
  statedObjective: string;
  pursuedStudy: string;
  pursuedNotes: string;
  diagnosedDisease: string;
  treatmentHistory: string;
  correlationHistory: string;
  patientHypothesis: string;
  markerLevels: string;
  aiFindings: string;
  healthProgression: string;
  studyResults: string;
  noteResults: string;
  possibleFindings: string;
  treatmentAssessment: string;
  dataRequisition: string;
  aiHypothesis: string;
  hypothesisEvaluation: string;
  doctorConversation: string;
  healthMarkers: string;
  patientPlan: string;
  patternAntipattern: string;
  clinicalSynthesis: string;
  criticalRatios: string;
  aiOnPlan: string;
  finalThoughts: string;
  abbreviations: string;
  treatmentGroups: string;
}

// The AI's partition of all proposed treatments into priority-ordered groups, each rendered as
// one shared bubble in Future Treatment. Refs are verbatim: `patient` entries match a
// factors.decisions[].intervention OR a PLANNED treatment's label (its name + dose); `ai`
// entries match a finding.decisions.ai[].intervention. Many-to-many (a group may have several of each) and
// either side may be empty (AI-only or patient-only group).
export interface TreatmentGroup {
  system: string; // the body system this cluster sits under; matches a disease[].group verbatim
  topic: string; // the drug class of the cluster (not a speculative benefit)
  patient: string[];
  ai: string[];
}

// A clinically meaningful ratio of two markers (e.g. Triglycerides : HDL), chosen
// by the Finding from the patient's challenges. Carries BOTH a general (population /
// guideline) range and a personalized range with explanations — so the dashboard can
// render it "just like any other marker" — plus the plain-language meaning. Value and
// trend are computed by the UI from the two component series, paired by quarter
// (components are not always drawn on the same day). See `marker-ratios.ts`.
export interface CriticalRatio {
  name: string;        // display name, e.g. "Triglycerides : HDL"
  numerator: string;   // component marker name — must match a marker in client.results
  denominator: string; // component marker name — must match a marker in client.results
  unit: string;        // ratio unit label; "" for a dimensionless ratio
  meaning: string;     // what the ratio signifies for this patient
  generalLow?: number;
  generalHigh?: number;
  generalExplanation: string;
  personalizedLow?: number;
  personalizedHigh?: number;
  explanation: string; // rationale for the personalized target
}

export interface ClientFinding {
  progression: {
    latest: string;
    recent: string;
    overall: string;
  };
  // One inference per populated Pursued Study row (each named study tuple);
  // `study` is the row label, `result` the prose.
  // `group` tags the body system (a disease[].group verbatim) so the UI
  // can render study lines under System Analysis headings; optional so older
  // findings without it still render (StudyResults falls back to a flat list).
  studyResults?: { study: string; result: string; group?: string }[];
  // One inference per populated Note row (factors.noteEntries); keyed by `noteId` rather than a
  // label (M92 — unlike Study's short hand-picked `focus` labels, a note's `text` is unbounded
  // free prose, unreliable for the LLM to echo back verbatim for pairing).
  noteResults?: { noteId: string; result: string; group?: string }[];
  // M94/M97 §C — one inference per known allergy (factors.allergies) / family history entry
  // (factors.familyHistory), keyed by id like noteResults, paired by array position (no natural
  // unique label to echo back).
  allergyResults?: { allergyId: string; result: string; group?: string }[];
  familyResults?: { familyId: string; result: string; group?: string }[];
  // M102 — mirrors allergyResults/familyResults exactly, for Reports diagnoses (factors.diseases),
  // which previously had no AI-paired leaf at all.
  diseaseResults?: { diseaseId: string; result: string; group?: string }[];
  disease: { group: string; finding: string }[];
  // `group` tags the body system this treatment targets (a disease[].group
  // verbatim) so Current Treatment groups by System Analysis; optional for older findings without it.
  // `phase` (per-bucket assessments) says WHICH slice of a drug's history this entry is about, so one
  // drug can carry up to three: its past arc, its current dose, its planned escalation. Optional
  // because every entry written before this existed is phase-less; such an entry still renders under
  // every bucket, exactly as it did, until that drug is next translated. See assessmentFor().
  /**
   * `treatmentId` echoes the TreatmentItem.id this assessment is ABOUT.
   *
   * noteResults/allergyResults/familyResults/diseaseResults were converted to id-echo pairing
   * earlier, leaving this section keyed on `item`, a name string the model writes with the dose appended
   * ("Rosuvastatin 20 mg"). Everything downstream then had to guess: matchByTreatmentName tries three
   * substring rules in order, a `used` set stops one row being claimed twice, and a rename has to
   * splice the new name into the stored string. treatment-bucket.ts took 25 changes in 403 lines —
   * the highest churn density in the codebase — and its history is a run of fixes to that guessing.
   *
   * OPTIONAL, because every Finding already in a vault was written without it. `assessmentFor`
   * prefers the id and falls back to the name rules, so stored answers keep resolving and the next
   * regeneration of a row upgrades it — the same legacy-read shim pattern as TreatmentItem.images.
   */
  treatment: { item: string; treatmentId?: string; assessment: string; group?: string; phase?: "past" | "ongoing" | "planned" }[];
  // Patient-specific clinical patterns / anti-patterns surfaced in the AI
  // Conclusion (distinct from the static methodology Introduction on page 1).
  patternAntipattern?: { pattern: string; antipattern: string };
  // Two-track trajectory synthesis: forces working against the patient
  // (structural / heritable / age-clock) vs gains working in their favor
  // (lifestyle- and treatment-driven), plus an optional qualitative
  // biological-vs-chronological read where the data supports one. Synthesizes
  // findings already established elsewhere in the report — it does not diagnose.
  // Optional so findings generated before this field existed still render.
  clinicalSynthesis?: { adverse: string; favorable: string; conditioning?: string };
  // Clinically meaningful marker ratios chosen from the patient's challenges,
  // rendered both as the "Critical Ratios" report section and as the dashboard
  // "Marker Ratios" cards. Optional so findings generated before this feature render.
  criticalRatios?: CriticalRatio[];
  decisions?: {
    patient: FindingDecisionEntry[];
    ai: FindingDecisionEntry[];
  };
  doctorConversation: { group: string; questions: string[] }[];
  definitions: { term: string; definition: string; group: string }[];
  healthMarkers: {
    recommended: { group: string; markers: { name: string; rationale: string }[] }[];
  };
  // `group` tags the body system this requisition cell informs (a disease[].group verbatim) so
  // Tests to Consider groups by System Analysis; optional for older findings without it (flat modality fallback).
  dataRequisition?: { type: string; group?: string; items: string[] }[];
  // AI-generated grouping of patient + AI proposed treatments (Future Treatment). Optional so
  // older findings without it still render (the UI falls back to a client-side heuristic).
  treatmentGroups?: TreatmentGroup[];
  planAssessment?: string;
  // The AI's assessment of each Patient Plan action individually (holistic summary stays in
  // planAssessment). Optional so older findings without it render (Treatment Plan falls back to holistic).
  planAssessmentRows?: { action: string; assessment: string }[];
  finalThoughts?: string;
  basis?: FindingBasis;
  generatedAt: string;
  inputsHash: string;
  // Per-node input hashes (a Dag node key → 12-hex sha256 of that node's input closure).
  // Drives per-section staleness (staleNodes) and selective regen. Optional so older findings without
  // it still render and fall back to the monolithic inputsHash.
  nodeHashes?: Record<string, string>;
  /**
   * A version-registry key → the version of the reasoning that wrote that section. `core` for
   * the monolithic call, a Dag node key for each leaf. See akesi-pil/ARCHITECTURE.md §8 *The
   * host's job: a brain registry* for the pattern this assumes a host maintains.
   *
   * Distinct from `nodeHashes`, and the pair is the point: nodeHashes answers "were the patient's
   * INPUTS the same", promptVersions answers "was the REASONING the same". A section can be fresh on
   * one and stale on the other, and only together do they say whether a stored answer is reproducible.
   *
   * Optional, and a missing entry means genuinely unknown — every finding written before this field
   * existed has none, and a section carried forward from a failed leaf keeps no version because the
   * reasoning that produced it may since have changed. Never defaulted to the current version: a
   * guess here would silently corrupt exactly the join a regen log exists to make.
   */
  promptVersions?: Record<string, string>;
  generatedBy?: GeneratedBy;
}

// The four sections whose items a finding GENERATES: a question, a glossary term, an
// exploration item, an analysis passage. None of them has a source record to hang a pin on, and
// none can be given a stable id, because the next finding rewrites the list wholesale. So the
// record is keyed by the item's own TEXT (normalized) and minted lazily — it exists only once the
// user has pinned it, and unpinning deletes it again. Nothing here is patient-entered content:
// losing a row costs a star, never data.
export type ItemRecordKind = "question" | "glossary" | "exploration" | "analysis" | "recommendedMarkers";

export interface ItemRecord {
  kind: ItemRecordKind;
  /** The item's text as it read when pinned — matched case- and whitespace-insensitively, so a
   *  regenerated Finding that only reflows the wording keeps the pin. */
  label: string;
  pinned?: boolean;
}

/**
 * One leaf regen, recorded before and after. See akesi-pil/ARCHITECTURE.md §8 *The host's job: a
 * brain registry* for the event-log pattern this assumes a host maintains (the append-only rule
 * and what is deliberately NOT recorded).
 *
 * `before`/`after` hold the Finding sections the merge actually rewrote, so a pair is directly
 * comparable. This is clinical content and therefore PHI: it lives in the vault, encrypted, and must
 * never be written anywhere the Finding itself would not go.
 */
export interface RegenEvent {
  at: string;
  /** finding-dag node key. */
  node: string;
  /**
   * The OPERATION that ran, not the reason it was needed. A single-section translate versus a
   * whole-finding refresh is all this system can honestly distinguish.
   */
  triggeredBy: "translate" | "refresh";
  /** Keys present in `before`/`after`, so a reader need not diff two objects to find the subject. */
  sections: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** The brain registry's entry for this node at the time of the regen; absent when the node has
   *  no registered version. */
  brainVersion?: string;
}

export interface Client {
  displayName: string;
  dob: string;
  gender: "male" | "female";
  watchlist: string[];
  // Starred Marker Ratios, kept separate from `watchlist` because a ratio is not a tracked
  // raw marker: it never belongs in the marker blocks, and nothing here is patient-entered, and it
  // is never read by the prompt directly. A ratio name is the finding's own
  // output (buildMarkerRatios derives it from finding.criticalRatios), so feeding a starred one
  // back as an AREA OF QUERY tells the model which of its own ratios to look at again. It reaches
  // the prompt through pinned-queries.ts only, never as a reading or a fact.
  // Absent = [] (defaulted at client creation).
  pinnedRatios?: string[];
  // Pins for the items that have no record of their own (see ItemRecord above). Absent = none
  // pinned; a record is appended on the first pin and removed again on unpin.
  itemRegistry?: ItemRecord[];
  recommended?: string[];
  results: MarkerResult[];
  factors?: ClientFactors;
  study?: ClientStudy;
  personalizedRanges?: Record<string, PersonalizedRange>;
  finding?: ClientFinding;
  // AI grouping of EVERY distinct marker (all sources: blood, scan, scale)
  // into the patient's body systems (finding.disease[].group verbatim), so the
  // Markers UI groups by System Analysis rather than by the lab panel an import
  // happened to name. Cross-source and decoupled from import structure. See
  // system-groups.ts.
  markerGroups?: MarkerGrouping;
  // Append-only history of leaf regens (see akesi-pil/ARCHITECTURE.md §8 *The host's job: a
  // brain registry*). PHI: it holds finding sections verbatim. Absent on every client that
  // predates the feature, and on one that has never regened.
  regenLog?: RegenEvent[];
  factorsHash?: string;
  sources?: SourceRecord[];
  // PHI-free tombstones for removed sources. A removal hard-deletes the
  // SourceRecord, its raw/processed files, and every derived datum it produced;
  // this leaves only a non-identifying "something was removed, when" record
  // (motivating case: a wrong-patient file ingested by mistake — expunge it and
  // prove it's gone). Re-ingesting the same sha clears its tombstone.
  removedSources?: RemovedSource[];
  // A host's per-patient visibility policy: feature key → shown to the
  // patient's own session. Absent key = the host's catalog default. The
  // provider sees everything regardless; this only narrows a patient's own view. Stored in
  // the patient vault (the patient decrypts it), so it's a product-surface control, not a
  // secret from a technical patient.
  patientVisibility?: Record<string, boolean>;
  // Files uploaded via the browser that the inline path can't process yet
  // (non-PDF: lab xlsx, DEXA, scale, unknown). The raw bytes are already in a host's object store; the
  // CLI `ingest --process-pending` parses + folds them, then removes the entry. Held
  // separate from sources[] because the kind/readings are unknown until processed.
  pendingUploads?: PendingUpload[];
}

// A browser upload awaiting out-of-band (CLI) processing. Content-addressed like a
// source, but with no parsed data yet — the "~24h" queue.
export interface PendingUpload {
  id: string; // sha256.slice(0,12), same key space as SourceRecord.id
  sha256: string;
  file: string; // the raw's provisional name under raw/{id}/ (<sha8>-<safeName>)
  originalName: string;
  uploadedAt: string;
}

export interface RemovedSource {
  sourceId: string; // the removed SourceRecord.id
  sha8: string;     // first 8 of the content hash (dedup key, non-identifying)
  kind: string;     // lab | dexa | scale | imaging
  removedAt: string;
}

export interface MarkerGrouping {
  // Each group's `group` is a finding.disease[].group name VERBATIM, or the
  // trailing "Not yet categorized" bucket (UNCATEGORIZED in system-groups.ts).
  groups: { group: string; markers: string[] }[];
  // sha256 (12-char) over the sorted distinct-marker set AND the sorted disease
  // group set at generation time, so a new marker OR a changed System Analysis is
  // detected and regrouped.
  markerGroupsHash: string;
  generatedAt: string;
  generatedBy: GeneratedBy;
}
