// Each person can reorder the menu groups and hide groups or single items. Hiding only tidies the menu: pages stay reachable by address,
// search and links, and every page still checks permission on the server. Unknown or no-longer-permitted entries are dropped.
export type MenuGroup = { id: string; title: string; icon: string; items: { href: string; label: string }[] };
// colors: chosen icon colour per group id (#rrggbb); theme: one of SIDEBAR_THEMES, "default" follows light/dark mode.
export type MenuPrefs = { order: string[]; hidden: string[]; colors: Record<string, string>; theme: string };

// Sidebar backgrounds a person can pick. All are dark so the white menu text stays readable.
export const SIDEBAR_THEMES: { id: string; label: string; bg: string | null; fg: string | null }[] = [
  { id: "default", label: "Midnight (default)", bg: null, fg: null },
  { id: "charcoal", label: "Charcoal", bg: "#18181b", fg: "#b4b4bd" },
  { id: "slate", label: "Slate", bg: "#1e293b", fg: "#b6c2d4" },
  { id: "ocean", label: "Ocean", bg: "#0b2540", fg: "#a9c4e0" },
  { id: "forest", label: "Forest", bg: "#0f2a22", fg: "#a7cdbd" },
  { id: "plum", label: "Plum", bg: "#2a1033", fg: "#d0b0dc" },
  { id: "wine", label: "Wine", bg: "#3a0d16", fg: "#e0b0b8" },
  { id: "espresso", label: "Espresso", bg: "#2b1a10", fg: "#d6bfa8" },
];

// Ready-made icon colours offered next to the free colour picker.
export const MENU_SWATCHES = ["#5648e8", "#8b5cf6", "#2563eb", "#0891b2", "#0d9488", "#059669", "#65a30d", "#d97706", "#f97316", "#e11d48", "#e11d74", "#64748b"];

const HEX = /^#[0-9a-f]{6}$/i;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Keep only entries that exist in what the person is allowed to see (group ids and item addresses).
export function sanitizeMenu(raw: unknown, groups: MenuGroup[]): MenuPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as { order?: unknown; hidden?: unknown; colors?: unknown; theme?: unknown };
  const ids = new Set(groups.map((g) => g.id));
  const hrefs = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  const order = [...new Set(strings(r.order).filter((id) => ids.has(id)))];
  for (const g of groups) if (!order.includes(g.id)) order.push(g.id);
  const colors: Record<string, string> = {};
  if (r.colors && typeof r.colors === "object" && !Array.isArray(r.colors)) {
    for (const [id, c] of Object.entries(r.colors as Record<string, unknown>)) if (ids.has(id) && typeof c === "string" && HEX.test(c)) colors[id] = c.toLowerCase();
  }
  const theme = typeof r.theme === "string" && SIDEBAR_THEMES.some((t) => t.id === r.theme) ? r.theme : "default";
  return { order, hidden: [...new Set(strings(r.hidden).filter((x) => ids.has(x) || hrefs.has(x)))], colors, theme };
}

// Dragging in the sidebar moves one shown group onto another shown group's place. Hidden groups keep their slots in the full order.
export function moveShown(order: string[], shown: string[], from: string, to: string): string[] {
  const vis = shown.filter((id) => order.includes(id));
  const i = vis.indexOf(from), j = vis.indexOf(to);
  if (i < 0 || j < 0 || i === j) return order;
  const next = [...vis];
  next.splice(i, 1);
  next.splice(j, 0, from);
  const slots = new Set(vis);
  let k = 0;
  return order.map((id) => (slots.has(id) ? next[k++] : id));
}

// Move one id to a new index in a list (used by the arrange dialog).
export function moveTo(list: string[], id: string, index: number): string[] {
  const i = list.indexOf(id);
  if (i < 0) return list;
  const n = [...list];
  n.splice(i, 1);
  n.splice(Math.max(0, Math.min(index, n.length)), 0, id);
  return n;
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
