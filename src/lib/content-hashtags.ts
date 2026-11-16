// Saved hashtag groups for the content calendar: a client's brand set, a campaign set, and so on, added to a post in one click.
import type { PrismaClient } from "@prisma/client";
import { ContentError } from "./content";

type Db = PrismaClient;

// "#a, b #a  #C" -> "#a #b #C": one # per tag, no spaces or commas inside, duplicates (ignoring case) dropped, at most 30
export function cleanTags(raw: string): string {
  const seen = new Set<string>(), out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const t = piece.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(`#${t}`);
  }
  return out.slice(0, 30).join(" ");
}

// Adds tags to a post's hashtags without repeating any
export const mergeTags = (current: string | null, add: string) => cleanTags(`${current ?? ""} ${add}`);

export async function saveHashtagGroup(db: Db, p: { organizationId: string; clientId: string | null; name: string; tags: string; actorId: string; id?: string }) {
  const name = p.name.trim(), tags = cleanTags(p.tags);
  if (name.length < 2 || name.length > 60) throw new ContentError("Give the group a name (2 to 60 characters).");
  if (!tags) throw new ContentError("Add at least one hashtag.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new ContentError("Client not found.");
  if (p.id) {
    const r = await db.hashtagGroup.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data: { name, tags } });
    if (r.count === 0) throw new ContentError("Hashtag group not found.");
    return db.hashtagGroup.findUniqueOrThrow({ where: { id: p.id } });
  }
  if ((await db.hashtagGroup.count({ where: { organizationId: p.organizationId, clientId: p.clientId } })) >= 30) throw new ContentError("A client can have up to 30 hashtag groups.");
  return db.hashtagGroup.create({ data: { organizationId: p.organizationId, clientId: p.clientId, name, tags, createdById: p.actorId } });
}

export async function deleteHashtagGroup(db: Db, p: { organizationId: string; id: string }) {
  const r = await db.hashtagGroup.deleteMany({ where: { id: p.id, organizationId: p.organizationId } });
  if (r.count === 0) throw new ContentError("Hashtag group not found.");
}

// The groups that can be used on a post: the post's client's own, or the company's own when it has no client
export const groupsFor = (db: Db, organizationId: string, clientId: string | null) =>
  db.hashtagGroup.findMany({ where: { organizationId, clientId }, orderBy: { name: "asc" } });
