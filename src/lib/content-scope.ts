import type { Prisma, PrismaClient } from "@prisma/client";

// Who sees which client's content. Same idea as projectScope: people who may see every project see every client's posts,
// brand kits and plans; everyone else sees only the clients they work for, meaning the client has a live project that
// they manage or belong to. A post assigned to the person directly stays visible to them.
type Db = Pick<PrismaClient, "project">;
export type ContentViewer = { id: string; organizationId: string; permissions: ReadonlySet<string> };

export const seesAllContent = (u: ContentViewer): boolean => u.permissions.has("projects.view_all");

// null = every client; otherwise the client ids the person works for
export async function contentClientIds(db: Db, u: ContentViewer): Promise<string[] | null> {
  if (seesAllContent(u)) return null;
  const rows = await db.project.findMany({
    where: { organizationId: u.organizationId, clientId: { not: null }, status: { not: "CANCELLED" }, OR: [{ managerId: u.id }, { members: { some: { userId: u.id } } }] },
    select: { clientId: true },
  });
  return [...new Set(rows.map((r) => r.clientId!))];
}

// Filter for ContentItem queries. Company-own posts (no client) show only to people who see everything, or the assignee.
export async function contentWhere(db: Db, u: ContentViewer): Promise<Prisma.ContentItemWhereInput> {
  const ids = await contentClientIds(db, u);
  const base: Prisma.ContentItemWhereInput = { organizationId: u.organizationId };
  return ids === null ? base : { ...base, OR: [{ clientId: { in: ids } }, { assignedToId: u.id }] };
}

export async function canSeeContentClient(db: Db, u: ContentViewer, clientId: string | null): Promise<boolean> {
  const ids = await contentClientIds(db, u);
  if (ids === null) return true;
  return clientId !== null && ids.includes(clientId);
}

export async function canSeeContentItem(db: Db, u: ContentViewer, item: { clientId: string | null; assignedToId: string | null }): Promise<boolean> {
  if (item.assignedToId === u.id) return true;
  return canSeeContentClient(db, u, item.clientId);
}

// For actions that take a post id from the form: true only when the post exists in the organization and the person may see it
export async function canSeeContentId(db: Pick<PrismaClient, "project" | "contentItem">, u: ContentViewer, id: string): Promise<boolean> {
  const item = await db.contentItem.findFirst({ where: { id, organizationId: u.organizationId }, select: { clientId: true, assignedToId: true } });
  return item ? canSeeContentItem(db, u, item) : false;
}

// Keeps only the ids of posts the person may see (bulk moves)
export async function visibleContentIds(db: Pick<PrismaClient, "project" | "contentItem">, u: ContentViewer, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.contentItem.findMany({ where: { AND: [await contentWhere(db, u), { id: { in: ids } }] }, select: { id: true } });
  return rows.map((r) => r.id);
}
