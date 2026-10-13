// Each person can reorder the menu groups and hide groups or single items. Hiding only tidies the menu: pages stay reachable by address,
// search and links, and every page still checks permission on the server. Unknown or no-longer-permitted entries are dropped.
export type MenuGroup = { id: string; title: string; icon: string; items: { href: string; label: string }[] };
export type MenuPrefs = { order: string[]; hidden: string[] };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Keep only entries that exist in what the person is allowed to see (group ids and item addresses).
export function sanitizeMenu(raw: unknown, groups: MenuGroup[]): MenuPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as { order?: unknown; hidden?: unknown };
  const ids = new Set(groups.map((g) => g.id));
  const hrefs = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  const order = [...new Set(strings(r.order).filter((id) => ids.has(id)))];
  for (const g of groups) if (!order.includes(g.id)) order.push(g.id);
  return { order, hidden: [...new Set(strings(r.hidden).filter((x) => ids.has(x) || hrefs.has(x)))] };
}

// The arranged menu. Never returns an empty menu: if the choices would hide everything, they are ignored.
export function applyMenu(groups: MenuGroup[], prefs: MenuPrefs): MenuGroup[] {
  const hidden = new Set(prefs.hidden);
  const pos = new Map(prefs.order.map((id, i) => [id, i]));
  const out = groups
    .filter((g) => !hidden.has(g.id))
    .map((g) => ({ ...g, items: g.items.filter((i) => !hidden.has(i.href)) }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  return out.length > 0 ? out : groups;
}
