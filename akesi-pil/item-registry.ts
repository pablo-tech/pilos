// Pins for the items a finding GENERATES — questions, glossary terms, exploration items, analysis
// passages — none of which has a source record to hang a pin on.
//
// Every other pinnable thing in a host app is a row the user typed: a note, a study entry, a
// treatment, an allergy. Those have ids, and a pin is just a boolean on the row. These four do not.
// The next finding rewrites their lists wholesale, so an index is meaningless and an id would be
// re-minted on every regeneration — a pin keyed either way would silently move to a different item
// or vanish. The item's own TEXT is the only thing that survives, so that is the key.
//
// Matching is deliberately loose (case- and whitespace-insensitive): a regeneration that reflows
// "Ferritin" to "ferritin " must keep the pin. A regeneration that says something genuinely
// different SHOULD lose it — the pin was about that text.
//
// Records are minted lazily and deleted on unpin, so an unpinned item costs nothing and the
// registry never accumulates rows for content that no longer exists.
import type { Client, ItemRecord, ItemRecordKind } from "./types";

const SEP = "::";

/** The opaque id the sidebar carries on a row (SidebarLeafRow.itemId) for a generated item. */
export function itemRecordId(kind: ItemRecordKind, label: string): string {
  return `${kind}${SEP}${label.trim()}`;
}

export function itemKindOf(id: string): ItemRecordKind {
  return id.slice(0, id.indexOf(SEP)) as ItemRecordKind;
}

export function itemLabelOf(id: string): string {
  return id.slice(id.indexOf(SEP) + SEP.length);
}


function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function matches(r: ItemRecord, kind: ItemRecordKind, label: string): boolean {
  return r.kind === kind && norm(r.label) === norm(label);
}

export function isItemPinned(client: Client, id: string): boolean {
  const kind = itemKindOf(id);
  const label = itemLabelOf(id);
  return (client.itemRegistry ?? []).some((r) => r.pinned && matches(r, kind, label));
}

/** Appends a pinned record on the first pin, drops it again on unpin. */
export function toggleItemPin(client: Client, id: string): Client {
  const kind = itemKindOf(id);
  const label = itemLabelOf(id);
  const prior = client.itemRegistry ?? [];
  const next = prior.some((r) => matches(r, kind, label))
    ? prior.filter((r) => !matches(r, kind, label))
    : [...prior, { kind, label, pinned: true } as ItemRecord];
  // Absent rather than [] when nothing is pinned — an untouched client's vault stays byte-identical
  // to what it was before this feature existed, and findingInputsCanonicalString omits the key.
  return next.length ? { ...client, itemRegistry: next } : (({ itemRegistry: _drop, ...rest }) => rest as Client)(client);
}

/** Convenience read for the sidebar builders, which have the text rather than the id. */
export function isPinnedItem(client: Client, kind: ItemRecordKind, label: string): boolean {
  return isItemPinned(client, itemRecordId(kind, label));
}

/** Every pinned generated item, in registry order. */
export function pinnedItems(client: Client): ItemRecord[] {
  return (client.itemRegistry ?? []).filter((r) => r.pinned);
}
