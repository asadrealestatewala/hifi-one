// Keeps each prospect's stored score up to date. The score itself is the pure function in prospect-score.ts; this reads what we know
// (the Google listing, the website check, the Facebook page), scores it and saves the number so lists can sort best first.
// It is called whenever a new fact arrives (search, website check, Facebook link or numbers), and by a manager's Update scores button.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { SERVICES, scoreProspect, type ProspectScore, type ScoreInput } from "./prospect-score";

type Db = PrismaClient;
export const MAX_RESCORE = 2000;

type Row = {
  name: string; website: string | null; rating: unknown; ratingCount: number | null;
  websiteCheck: (NonNullable<ScoreInput["check"]>) | null; social: (NonNullable<ScoreInput["social"]>) | null;
};
export function inputFor(r: Row, now?: Date): ScoreInput {
  return { name: r.name, hasWebsite: Boolean(r.website?.trim()), rating: r.rating == null ? null : Number(r.rating), ratingCount: r.ratingCount, check: r.websiteCheck, social: r.social, now };
}
export const prospectInclude = {
  websiteCheck: { select: { status: true, reachable: true, https: true, hasTitle: true, hasMetaDescription: true, hasAnalytics: true, hasGtm: true, hasMetaPixel: true, hasContactForm: true, hasWhatsapp: true, lowConfidence: true, mobileScore: true, seoScore: true } },
  social: { select: { facebookUrl: true, status: true, followers: true, lastPostAt: true } },
} as const;

// Scores and saves the given prospects (all of an organization's when `ids` is null). Returns how many were saved.
export async function rescoreProspects(db: Db, organizationId: string, ids: string[] | null, now = new Date()): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const rows = await db.prospect.findMany({
    where: { organizationId, ...(ids ? { id: { in: ids.slice(0, MAX_RESCORE) } } : {}) },
    select: { id: true, name: true, website: true, rating: true, ratingCount: true, ...prospectInclude },
    orderBy: { createdAt: "desc" }, take: MAX_RESCORE,
  });
  let saved = 0;
  for (const r of rows) {
    const s = scoreProspect(inputFor(r as unknown as Row, now));
    await db.prospect.update({ where: { id: r.id }, data: { score: s.score, scoreService: s.topService, scoreVersion: s.version, scoredAt: now } });
    saved++;
  }
  return saved;
}

// The full score with reasons and pitch for one prospect, scored fresh from what is known now. Null when it is not in the organization.
export async function scoreOne(db: Db, organizationId: string, id: string, now = new Date()): Promise<ProspectScore | null> {
  const r = await db.prospect.findFirst({ where: { id, organizationId }, select: { id: true, name: true, website: true, rating: true, ratingCount: true, ...prospectInclude } });
  return r ? scoreProspect(inputFor(r as unknown as Row, now)) : null;
}

export const serviceLabel = (key: string | null) => (key && key in SERVICES ? SERVICES[key as keyof typeof SERVICES].label : null);
