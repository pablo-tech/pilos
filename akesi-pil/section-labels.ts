// The one table of section display names. Kept separate from any host's presentation metadata
// (icon, kind, blurb) so this package can name a section without depending on host branding, and
// so there is exactly one spelling per key. The label lived in three places before this file
// existed, and the three had drifted.
export const SECTION_LABEL: Record<string, string> = {
  analysis: "Analysis",
  study: "Study",
  futureTreatment: "Hypothesis",
  exploration: "Exploration",
  treatment: "Treatment",
  personalization: "Profile",
  allergies: "Allergies",
  familyHistory: "Family",
  markers: "Markers",
  clinicalReports: "Reports",
  notes: "Notes",
  docInference: "Questions",
  healthMarkers: "Recommended Markers",
  definitions: "Glossary",
};
