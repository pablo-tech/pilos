// Canonical names for imaging-derived markers. LLM extraction (claude-report.ts)
// names the same metric inconsistently across runs/reports ("LVEF" vs "LV
// Ejection Fraction (Biplane Simpson)"), and because marker name is the de-facto
// primary key (ranges, dedup, trends), that drift fragments a metric into
// separate series. This is the imaging analogue of the STABLE names the
// deterministic blood/DEXA parsers emit by construction.
//
// canonicalImagingMarker() maps a raw extracted name to its canonical form:
// pure case/whitespace/punctuation variants of a canonical name collapse
// automatically; genuinely different phrasings are listed in ALIASES. Unknown
// names pass through unchanged (the alias map is the knob — extend it as new
// metrics appear).

export const CANONICAL_IMAGING_MARKERS: string[] = [
  // Cardiac CT
  "Coronary artery calcium (CAC) score",
  "CAC score — left main",
  "CAC score — left anterior descending",
  "CAC score — circumflex",
  "CAC score — right coronary artery",
  // Echocardiogram
  "Left ventricular ejection fraction (LVEF)",
  "Left ventricular end-diastolic volume",
  "Left ventricular end-systolic volume",
  "TAPSE",
  "Aortic root diameter",
  "Ascending aorta diameter",
  "Left atrial volume (A4C)",
  "Right atrial volume (A4C)",
  "E/A ratio",
  "E/e′ average",
  "e′ average",
  "Left ventricular mass",
  "LVOT stroke-volume index",
  "Left atrial volume index",
  "Right atrial volume index",
  "IVC diameter",
  "Aortic valve area",
  "Aortic valve area index",
  "Aortic valve max velocity",
  "Aortic valve peak gradient",
  "Aortic valve mean gradient",
  // Renal / abdominal ultrasound
  "Right kidney length",
  "Left kidney length",
  "Right renal cortical thickness",
  "Left renal cortical thickness",
  "Pre-void bladder volume",
  "Post-void residual volume",
  "Prostate volume",
  "Common bile duct diameter",
];

// Variant phrasing → canonical. Keys are matched after normalization, so only
// genuinely different wording needs an entry (not mere case/spacing/dash diffs).
const ALIASES: Record<string, string> = {
  "lv ejection fraction biplane simpson": "Left ventricular ejection fraction (LVEF)",
  "lv ejection fraction biplane simpson s": "Left ventricular ejection fraction (LVEF)",
  "left ventricular ejection fraction biplane simpson": "Left ventricular ejection fraction (LVEF)",
  "lvef": "Left ventricular ejection fraction (LVEF)",
  "lv end diastolic volume biplane": "Left ventricular end-diastolic volume",
  "lv end systolic volume biplane": "Left ventricular end-systolic volume",
  "lad cac score": "CAC score — left anterior descending",
  "mid ascending aorta diameter": "Ascending aorta diameter",
  "right kidney size": "Right kidney length",
  "left kidney size": "Left kidney length",
  "post void residual": "Post-void residual volume",
  "post void residual bladder volume": "Post-void residual volume",
  "ava": "Aortic valve area",
  "avai": "Aortic valve area index",
  "ava index": "Aortic valve area index",
  "aortic valve area indexed": "Aortic valve area index",
  "peak gradient": "Aortic valve peak gradient",
  "aortic valve peak instantaneous gradient": "Aortic valve peak gradient",
  "e e prime average": "E/e′ average",
  "e e prime": "E/e′ average",
  "e e ratio": "E/e′ average",
  "e prime average": "e′ average",
  "lv mass": "Left ventricular mass",
  "lvot svi": "LVOT stroke-volume index",
  "lvot stroke volume index si": "LVOT stroke-volume index",
  "stroke volume index": "LVOT stroke-volume index",
  "la volume index": "Left atrial volume index",
  "lavi": "Left atrial volume index",
  "left atrial volume index biplane": "Left atrial volume index",
  "ra volume index": "Right atrial volume index",
  "ravi": "Right atrial volume index",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// normalized canonical form → canonical display name (auto-handles case/space/dash variants)
const CANON_BY_NORM = new Map<string, string>(CANONICAL_IMAGING_MARKERS.map((c) => [normalize(c), c]));

export function canonicalImagingMarker(name: string): string {
  const key = normalize(name);
  return ALIASES[key] ?? CANON_BY_NORM.get(key) ?? name.trim();
}

// Whether `name` is in the catalog (an alias or a canonical form) vs passed
// through verbatim. Drives the ingest-time "uncataloged marker" report so
// divergent names surface for cataloging instead of silently splitting a series.
export function isKnownImagingMarker(name: string): boolean {
  const key = normalize(name);
  return key in ALIASES || CANON_BY_NORM.has(key);
}
