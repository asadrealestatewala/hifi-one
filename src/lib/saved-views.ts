// Saved views: a named combination of a list's filters and sort that a person can return to with one click. They are personal
// (stored in UserPreference), hold only a whitelisted query string, and a view can never grant access: the page applies its own
// permission and scope every time it opens.
import type { PrismaClient } from "@prisma/client";

export class ViewError extends Error {}

export const VIEW_LISTS: Record<string, { path: string; permission: string; params: readonly string[] }> = {
  clients: { path: "/clients", permission: "clients.view", params: ["q", "show", "sort", "dir"] },
  invoices: { path: "/finance/invoices", permission: "finance.view", params: ["q", "status", "sort", "dir"] },
};
export type SavedView = { name: string; query: string };
const MAX_VIEWS = 10;
const key = (list: string) => `views:${list}`;

export function cleanQuery(list: string, raw: string): string {
  const def = VIEW_LISTS[list];
  if (!def) throw new ViewError("Unknown list.");
  const src = new URLSearchParams(raw.replace(/^\?/, ""));
  const out = new URLSearchParams();
  for (const k of def.params) {
    const v = src.get(k)?.trim().slice(0, 100);
    if (v) out.set(k, v);
  }
  return out.toString();
}

export async function loadViews(db: PrismaClient, userId: string, list: string): Promise<SavedView[]> {
  const row = await db.userPreference.findUnique({ where: { userId_key: { userId, key: key(list) } } });
  const v = row?.value;
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (x && typeof x === "object" && typeof (x as SavedView).name === "string" && typeof (x as SavedView).query === "string" ? [{ name: (x as SavedView).name, query: (x as SavedView).query }] : []));
}

export async function saveView(db: PrismaClient, p: { userId: string; list: string; name: string; query: string }) {
  const name = p.name.trim().slice(0, 40);
  if (name.length < 2) throw new ViewError("Give the view a name.");
  const query = cleanQuery(p.list, p.query);
  if (!query) throw new ViewError("Apply a filter or a sort first, then save it.");
  const views = (await loadViews(db, p.userId, p.list)).filter((v) => v.name.toLowerCase() !== name.toLowerCase());
  if (views.length >= MAX_VIEWS) throw new ViewError(`You can keep ${MAX_VIEWS} views per list. Remove one first.`);
  const next = [...views, { name, query }];
  await db.userPreference.upsert({ where: { userId_key: { userId: p.userId, key: key(p.list) } }, create: { userId: p.userId, key: key(p.list), value: next }, update: { value: next } });
  return next;
}

export async function deleteView(db: PrismaClient, p: { userId: string; list: string; name: string }) {
  const views = (await loadViews(db, p.userId, p.list)).filter((v) => v.name !== p.name);
  await db.userPreference.upsert({ where: { userId_key: { userId: p.userId, key: key(p.list) } }, create: { userId: p.userId, key: key(p.list), value: views }, update: { value: views } });
  return views;
}
