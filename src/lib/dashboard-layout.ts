// Which dashboard widgets a person sees and in what order. Stored per user; unknown or no-longer-permitted widgets are ignored,
// and widgets added later appear at the end instead of vanishing.
import type { PrismaClient } from "@prisma/client";

export type Layout = { order: string[]; hidden: string[] };
const KEY = "dashboard";

export function resolveLayout(saved: unknown, available: string[]): Layout {
  const s = (saved && typeof saved === "object" ? saved : {}) as { order?: unknown; hidden?: unknown };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ok = new Set(available);
  const order = [...new Set(strs(s.order).filter((id) => ok.has(id)))];
  for (const id of available) if (!order.includes(id)) order.push(id);
  return { order, hidden: [...new Set(strs(s.hidden).filter((id) => ok.has(id)))] };
}

export async function loadLayout(db: PrismaClient, userId: string, available: string[]): Promise<Layout> {
  const row = await db.userPreference.findUnique({ where: { userId_key: { userId, key: KEY } } });
  return resolveLayout(row?.value, available);
}

export async function saveLayout(db: PrismaClient, userId: string, input: Layout, available: string[]): Promise<Layout> {
  const layout = resolveLayout(input, available);
  await db.userPreference.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: layout },
    update: { value: layout },
  });
  return layout;
}

export async function resetLayout(db: PrismaClient, userId: string) {
  await db.userPreference.deleteMany({ where: { userId, key: KEY } });
}
