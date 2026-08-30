// The one place body-system grouping lives. The System Analysis (finding.disease) is what
// establishes a patient's body-system risks ("Cardiovascular Risk", "Metabolic Health", …) and the
// order they rank in (severity, highest first). Every section that groups by body system — Current
// Treatment, Study Result, Treatment Plan, Hypothesis, Questions for Dr — orders by this
// and defers to it for whether grouping is possible at all. Until the Finding runs there are no
// systems to group under, so those sections fall back to a flat, ungrouped list (see PendingGrouping).

import type { Client } from "./types";

// The trailing bucket for items that exist but carry no (or an unknown) system — e.g. a treatment
// added after the Finding, or one the model didn't tag. Signals a Finding refresh would place it.
export const UNCATEGORIZED = "Not yet categorized";

// The canonical body-system order: disease groups in the AI's severity order.
export function systemOrder(client: Client): string[] {
  return (client.finding?.disease ?? []).map((d) => d.group);
}

// Have the AI's per-system risks been established yet? Grouping is only possible once they have.
export function systemAnalysisEstablished(client: Client): boolean {
  return (client.finding?.disease?.length ?? 0) > 0;
}

// Bucket a flat list under body-system headings, in systemOrder, with any item whose group is
// missing or unknown swept into a trailing UNCATEGORIZED bucket so coverage is exactly-once and
// complete. Returns null when the System Analysis isn't established — the caller's cue to render its
// flat fallback plus a PendingGrouping note. Order within a bucket is preserved from `items`.
export function groupBySystem<T>(
  client: Client,
  items: T[],
  getGroup: (item: T) => string | undefined,
): { system: string; rows: T[] }[] | null {
  const order = systemOrder(client);
  if (order.length === 0) return null;
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const g = getGroup(it);
    const key = g && order.includes(g) ? g : UNCATEGORIZED;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(it);
  }
  return [...order, UNCATEGORIZED].filter((s) => buckets.has(s)).map((system) => ({ system, rows: buckets.get(system)! }));
}
