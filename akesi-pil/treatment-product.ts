// The product side of a treatment — description, ingredients, links — as pure functions shared by
// the browser form, the inference endpoint's validator, the staleness hash and the search index.
//
// Kept out of treatment-bucket.ts on purpose: that module owns dose and TIMING, and the one rule
// this feature must never break is that a product's label amounts stay away from formatDose() /
// treatmentLabel(). Different file, different concern, no import back the other way.

import type { Administration, Ingredient, ProductLink, TreatmentItem } from "./types";

/**
 * A URL safe to store and render. http/https only — a `javascript:` or `data:` href reaching an
 * anchor is a script-injection vector, and these URLs arrive from model output over pasted text,
 * which is exactly the untrusted boundary worth validating at.
 */
export function safeProductUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/** Drops anything unnamed or malformed rather than storing a half-record. */
export function cleanIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  const out: Ingredient[] = [];
  for (const item of raw) {
    const i = item as Partial<Ingredient>;
    const name = typeof i?.name === "string" ? i.name.trim() : "";
    if (!name) continue;
    const amount = typeof i.amount === "number" && Number.isFinite(i.amount) ? i.amount : undefined;
    const unit = typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : undefined;
    const form = typeof i.form === "string" && i.form.trim() ? i.form.trim() : undefined;
    out.push({ name, ...(amount != null ? { amount } : {}), ...(unit ? { unit } : {}), ...(form ? { form } : {}) });
  }
  return out;
}

/** A link with no usable URL is dropped; a link with no label falls back to its own host. */
export function cleanLinks(raw: unknown): ProductLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductLink[] = [];
  for (const item of raw) {
    const l = item as Partial<ProductLink>;
    const url = safeProductUrl(l?.url);
    if (!url) continue;
    const label = typeof l.label === "string" && l.label.trim() ? l.label.trim() : new URL(url).hostname;
    out.push({ label, url });
  }
  return out;
}

/** "100mcg Selenium (L-Selenomethionine)" — display and prompt use the same rendering. */
export function formatIngredient(i: Ingredient): string {
  const amount = i.amount != null ? `${i.amount}${i.unit ?? ""} ` : "";
  return `${amount}${i.name}${i.form ? ` (${i.form})` : ""}`;
}

export function hasProductData(
  t: Pick<TreatmentItem, "description" | "maker" | "ingredients" | "links" | "administration">,
): boolean {
  return !!t.description?.trim() || !!t.maker?.trim() || !!t.ingredients?.length || !!t.links?.length || !!t.administration;
}

/**
 * Whether a medicine-scope save is newly attaching `administration` for the first time, or
 * changing its `unit` vs. what the medicine's rows already carry — the trigger for relabeling
 * every sibling dose row's `doseUnit` to match. Same trimmed/lowercased comparison
 * computeConclusion uses for its own unit-mismatch check, so "unchanged" here means it already
 * agreed the units matched.
 */
export function administrationUnitChanged(
  prevAdministration: Administration | undefined,
  nextAdministration: Administration | undefined,
): boolean {
  if (!nextAdministration) return false;
  if (!prevAdministration) return true;
  return prevAdministration.unit.trim().toLowerCase() !== nextAdministration.unit.trim().toLowerCase();
}

/**
 * The product half of a treatment's staleness signature, or "" when there is none.
 *
 * Returning "" — rather than a run of empty pipes — is what keeps this rollout free. treatmentCanonical
 * builds one pipe-joined string per treatment, so appending unconditionally would change EVERY
 * existing treatment's signature, mark all of them stale, and fire a full regeneration for every user
 * on next load. Same reasoning as the allergy/family summaries in factors-hash.ts, which omit their
 * key outright when empty instead of emitting [].
 */
export function productCanonical(
  t: Pick<TreatmentItem, "description" | "maker" | "ingredients" | "links" | "administration">,
): string {
  if (!hasProductData(t)) return "";
  const ingredients = (t.ingredients ?? []).map(formatIngredient).join(";");
  const links = (t.links ?? []).map((l) => `${l.label}=${l.url}`).join(";");
  // `maker` and `administration` are both appended ONLY when present — not into the middle of the
  // original {description, ingredients, links} slots — so a record that predates either field
  // (every treatment that already had product data before this milestone) produces the EXACT same
  // string as before. Inserting a new fixed slot there, even an empty one, would still reshape
  // every existing record's signature and fire the same unwanted mass regen this file exists to
  // avoid — see the doc comment above.
  const maker = t.maker?.trim() ? `|${t.maker.trim()}` : "";
  const admin = t.administration
    ? `|${t.administration.unit}|${t.administration.unitsPerServing}|${t.administration.suggestedUnits}|${t.administration.suggestedFrequency}|${t.administration.containerQuantity ?? ""}`
    : "";
  return `|${t.description?.trim() ?? ""}|${ingredients}|${links}${maker}${admin}`;
}
