// M54/4 — treatment add-flow intake: read what the user actually has about a product — photos of a
// bottle/package/label, or the product sheet as pasted text — and propose a record. Pure of
// Node/process/env, mirroring report-extract.ts's shape. The Anthropic client is INJECTED and the
// model is a required arg (no default), so this module never touches process.env or the config.
//
// ONE function serves both inputs on purpose. The extraction task is the same task whichever way
// the label arrives, and the rule that must not drift between them — label amounts are product
// facts, never the patient's dose — is stated once here rather than twice.
import type Anthropic from "@anthropic-ai/sdk";
import { cleanIngredients, cleanLinks } from "./treatment-product";
import type { Administration, DoseFrequency, Ingredient, ProductLink } from "./types";

export const TREATMENT_INFER_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    kind: { type: "string", enum: ["drug", "supplement"] },
    description: { type: "string" },
    maker: { type: "string" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
          form: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, url: { type: "string" } },
        required: ["label", "url"],
        additionalProperties: false,
      },
    },
    administration: {
      type: "object",
      properties: {
        unit: { type: "string" },
        unitsPerServing: { type: "number" },
        suggestedUnits: { type: "number" },
        suggestedFrequency: { type: "string", enum: ["day", "week", "month", "as needed"] },
        containerQuantity: { type: "number" },
      },
      required: ["unit", "suggestedUnits", "suggestedFrequency"],
      additionalProperties: false,
    },
  },
  required: ["name", "kind"],
  additionalProperties: false,
} as const;

export interface ProposedTreatment {
  name: string;
  kind: "drug" | "supplement";
  description?: string;
  maker?: string;
  ingredients?: Ingredient[];
  links?: ProductLink[];
  administration?: Administration;
}

// Structural — mirrors report-extract.ts's UsageRecorder so a caller's existing usage accumulator
// satisfies this, with no cost-accounting module dragged in.
export interface UsageRecorder {
  record(
    model: string,
    usage:
      | {
          input_tokens?: number | null;
          output_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
          cache_read_input_tokens?: number | null;
        }
      | null
      | undefined,
  ): void;
}

const SYSTEM_PROMPT = [
  "You read what a user has about ONE medication or supplement — photos of a bottle, blister",
  "pack, box or prescription label, or the product's own written sheet — and return strict JSON",
  "matching the requested schema.",
  "",
  "Extract:",
  "- name: the product's name as printed (brand name, or generic if that is what is printed).",
  "  Keep it concise — just the name, no dose and no marketing suffix.",
  "- kind: \"drug\" for a prescription or OTC medication, \"supplement\" for a vitamin, mineral,",
  "  herbal, or other dietary supplement.",
  "- description: what the product is and what it is for, in the source's own terms. Fold in any",
  "  cost, storage, manufacturing or protocol prose rather than dropping it. Omit when the source",
  "  offers nothing beyond a name.",
  "- maker: the manufacturer or brand as printed (e.g. \"Thorne\", \"Pfizer\"), if the source states",
  "  one. Omit when the source doesn't say.",
  "- ingredients: one entry per active ingredient listed, with `amount` and `unit` EXACTLY as",
  "  printed on the label, and `form` for the chemical form or source in parentheses",
  "  (\"L-Selenomethionine\", \"20% Coleus Forskohlii Extract\"). Omit entirely when none is listed.",
  "- links: any URL the source gives, each with the label it is given (\"Third-party testing\").",
  "  Only real URLs — never invent one, and never turn a bare reference number into a link.",
  "- administration: the label's OWN suggested serving/administration, if it states one — e.g.",
  "  \"Take one capsule daily\", \"1 scoop with 8oz water, 1-2 times per day\", \"Adults chew one",
  "  tablet twice daily\". `unit` is the countable unit the label itself uses (capsule, tablet,",
  "  softgel, scoop, gummy, mL, spray, patch, drop, packet — whatever word the label uses).",
  "  `unitsPerServing` is how many of that unit make up ONE printed serving, ONLY when the label",
  "  states a Serving Size distinct from its dosing line (default 1 when it does not).",
  "  `suggestedUnits` is the count of that unit the label says to take per administration.",
  "  `suggestedFrequency` is how often the label says to take it (\"day\", \"week\", \"month\", or",
  "  \"as needed\" for an as-needed/PRN product). `containerQuantity` is the TOTAL count of that",
  "  unit the package itself holds, if printed (e.g. a bottle labeled \"60 Capsules\" → 60) — this",
  "  is the package's total, NOT the per-administration count above; omit it when the source",
  "  doesn't state a total. Omit the whole administration field when the label gives no",
  "  administration instruction at all.",
  "",
  "THE DOSE RULE — the one that matters most:",
  "An ingredient amount is a LABEL FACT about the product: what ONE capsule, tablet or serving",
  "contains. It is NOT how much the patient takes. Every amount you read off an ingredient list",
  "belongs in ingredients[], and nowhere else. The label's OWN suggested serving belongs in",
  "administration (above) the same way — \"the label suggests 1 capsule per day\" is also a LABEL",
  "FACT, no different in kind from an ingredient amount, and you should extract it whenever the",
  "label states one. What you must never do, under ANY field, is assert or imply what THIS PATIENT",
  "actually takes: administration is what the LABEL recommends, not a report of the patient's own",
  "behavior, and a \"Protocol\" or \"Directions\" line describes that same label recommendation, not",
  "a patient history. Do NOT infer, guess, or output a dose, dosage, strength, quantity, frequency,",
  "or timing FOR THE PATIENT under any field other than administration — not from the",
  "ingredient list, not from the pack size, not from anything else you read. A product containing",
  "100mcg of selenium, or a label suggesting 1 capsule daily, tells you nothing about what THIS",
  "patient takes — the patient's own quantity, frequency and time of day are entered separately,",
  "after this step, and may differ from what the label suggests. Your job stops at the label.",
  "",
  "If multiple photos are provided, they are the same item from different angles; use all of them",
  "to identify it once.",
].join("\n");

export interface TreatmentInferInput {
  images?: { base64: string; mediaType: "image/jpeg" | "image/png" }[];
  text?: string;
}

export async function inferTreatment(
  anthropic: Anthropic,
  input: TreatmentInferInput,
  model: string,
  maxTokens: number,
  usage?: UsageRecorder,
): Promise<ProposedTreatment> {
  const images = input.images ?? [];
  const text = input.text?.trim() ?? "";
  if (images.length === 0 && !text) throw new Error("treatment inference needs photos or text");
  const content = [
    ...images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
    })),
    {
      type: "text" as const,
      text: text
        ? `Extract the product described by this source text as JSON.\n\n${text}`
        : "Identify the drug or supplement in the photo(s) as JSON.",
    },
  ];
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: TREATMENT_INFER_SCHEMA },
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error("image inference truncated (hit max_tokens) — raise TREATMENT_INFER_MAX_TOKENS in treatment-infer-config.ts");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(
      `no text block in response — stop_reason=${response.stop_reason}, types=${response.content.map((b) => b.type).join(",")}`,
    );
  }
  let parsed: ProposedTreatment;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error(`invalid JSON for image inference: ${textBlock.text.slice(0, 200)}`);
  }
  validate(parsed);
  usage?.record(model, response.usage);
  return parsed;
}

// Validates name/kind strictly (a bad one is a failed inference) and NORMALIZES the product fields
// leniently through the shared cleaners: a malformed ingredient or an unsafe URL is dropped rather
// than failing the whole extraction, since the name/kind half is still worth having. cleanLinks is
// also the boundary that rejects a javascript:/data: URL the model may have echoed out of the source.
export function validate(r: ProposedTreatment): void {
  if (typeof r.name !== "string" || r.name.trim() === "") {
    throw new Error("image inference result missing name");
  }
  if (r.kind !== "drug" && r.kind !== "supplement") {
    throw new Error(`image inference result kind must be "drug" or "supplement", got ${JSON.stringify(r.kind)}`);
  }
  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (description) r.description = description;
  else delete r.description;
  const maker = typeof r.maker === "string" ? r.maker.trim() : "";
  if (maker) r.maker = maker;
  else delete r.maker;
  const ingredients = cleanIngredients(r.ingredients);
  if (ingredients.length) r.ingredients = ingredients;
  else delete r.ingredients;
  const links = cleanLinks(r.links);
  if (links.length) r.links = links;
  else delete r.links;
  const admin = r.administration as Partial<Administration> | undefined;
  const validFrequency = (["day", "week", "month", "as needed"] as DoseFrequency[]).includes(
    admin?.suggestedFrequency as DoseFrequency,
  );
  if (admin && typeof admin.unit === "string" && admin.unit.trim() && typeof admin.suggestedUnits === "number" && Number.isFinite(admin.suggestedUnits) && validFrequency) {
    const containerQuantity = typeof admin.containerQuantity === "number" && Number.isFinite(admin.containerQuantity) && admin.containerQuantity > 0
      ? admin.containerQuantity
      : undefined;
    r.administration = {
      unit: admin.unit.trim(),
      unitsPerServing: typeof admin.unitsPerServing === "number" && Number.isFinite(admin.unitsPerServing) && admin.unitsPerServing > 0 ? admin.unitsPerServing : 1,
      suggestedUnits: admin.suggestedUnits,
      suggestedFrequency: admin.suggestedFrequency as DoseFrequency,
      ...(containerQuantity != null ? { containerQuantity } : {}),
    };
  } else delete r.administration;
}
