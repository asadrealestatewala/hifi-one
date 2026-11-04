// Prospector stage 3: a prospect's Facebook page. The address is found on the business's own website (during the website check) or typed
// by a person; the numbers (followers, likes, last post date) come from a SocialProvider. Every provider request goes through the call
// ledger first (monthly and daily caps), nothing is fetched for a prospect without an address, and a click handles at most 5 businesses
// so one press cannot use much of a 200-request month. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { BudgetError, releaseCall, reserveCall, socialCaps, usage, type Caps } from "./api-budget";
import { normalizeFacebookUrl } from "./facebook-link";
import { getKey } from "./integration-keys";
import { canSearch, isManager, prospectScope, type Actor } from "./prospector";
import { SocialError, socialApis, type SocialProvider } from "./social";
import { rescoreProspects } from "./prospect-scoring";

type Db = PrismaClient;
export const SOCIAL_FRESH_DAYS = 7;
export const MAX_FETCH_PER_CLICK = 5;
export class SocialAccessError extends Error {}

export type SocialDeps = { provider: SocialProvider; key: (organizationId: string) => Promise<string | undefined>; caps: Caps };
const realDeps = (db: Db): SocialDeps => ({ provider: socialApis(), key: (org) => getKey(db, org, "SOCIALAPIS"), caps: socialCaps() });

const allowed = (actor: Actor) => isManager(actor) || canSearch(actor);

// Called by the website check when it finds a Facebook link on the home page. A person's own entry is never replaced.
export async function recordDiscoveredLink(db: Db, p: { prospectId: string; organizationId: string; url: string | null }) {
  if (!p.url) return;
  const cur = await db.prospectSocial.findUnique({ where: { prospectId: p.prospectId }, select: { source: true, facebookUrl: true } });
  if (cur?.source === "MANUAL" || cur?.facebookUrl === p.url) return;
  await db.prospectSocial.upsert({
    where: { prospectId: p.prospectId },
    create: { prospectId: p.prospectId, organizationId: p.organizationId, facebookUrl: p.url, source: "WEBSITE" },
    update: { facebookUrl: p.url, source: "WEBSITE", status: "NOT_FETCHED", pageName: null, followers: null, likes: null, lastPostAt: null, note: null, fetchedAt: null, provider: null },
  });
  await rescoreProspects(db, p.organizationId, [p.prospectId]);
}

// A person types (or clears) the Facebook address. Returns the saved address, or null when it was cleared.
export async function setFacebookLink(db: Db, actor: Actor, prospectId: string, raw: string): Promise<string | null> {
  if (!allowed(actor)) throw new SocialAccessError("You do not have access to change Facebook links.");
  const p = await db.prospect.findFirst({ where: { AND: [prospectScope(actor), { id: prospectId }] }, select: { id: true } });
  if (!p) throw new SocialAccessError("That prospect is not available to you.");
  const text = raw.trim();
  if (text === "") { await db.prospectSocial.deleteMany({ where: { prospectId } }); await rescoreProspects(db, actor.organizationId, [prospectId]); return null; }
  const url = normalizeFacebookUrl(text);
  if (!url) throw new SocialAccessError("That is not the address of a Facebook page. Paste the page's link, for example facebook.com/yourbusiness.");
  await db.prospectSocial.upsert({
    where: { prospectId },
    create: { prospectId, organizationId: actor.organizationId, facebookUrl: url, source: "MANUAL" },
    update: { facebookUrl: url, source: "MANUAL", status: "NOT_FETCHED", pageName: null, followers: null, likes: null, lastPostAt: null, note: null, fetchedAt: null, provider: null },
  });
  await rescoreProspects(db, actor.organizationId, [prospectId]);
  return url;
}

export type FetchSummary = { fetched: number; noLink: number; fresh: number; failed: number; stopped: string | null; notConfigured: boolean; skipped: number; left: number };

export async function fetchFacebookData(db: Db, actor: Actor, ids: string[], opts: { force?: boolean; now?: Date; deps?: Partial<SocialDeps> } = {}): Promise<FetchSummary> {
  if (!allowed(actor)) throw new SocialAccessError("You do not have access to get Facebook data.");
  const deps = { ...realDeps(db), ...opts.deps };
  const now = opts.now ?? new Date();
  const wanted = [...new Set(ids)];
  const rows = await db.prospect.findMany({ where: { AND: [prospectScope(actor), { id: { in: wanted }, status: { not: "DISMISSED" } }] }, select: { id: true, social: true }, orderBy: { createdAt: "asc" } });
  const out: FetchSummary = { fetched: 0, noLink: 0, fresh: 0, failed: 0, stopped: null, notConfigured: false, skipped: wanted.length - rows.length, left: 0 };
  const todo: { id: string; url: string }[] = [];
  for (const r of rows) {
    const s = r.social;
    if (!s?.facebookUrl) { out.noLink++; continue; }
    if (!opts.force && s.status === "OK" && s.fetchedAt && now.getTime() - s.fetchedAt.getTime() < SOCIAL_FRESH_DAYS * 86_400_000) { out.fresh++; continue; }
    todo.push({ id: r.id, url: s.facebookUrl });
  }
  if (todo.length === 0) return out;
  const key = await deps.key(actor.organizationId);
  if (!key) { out.notConfigured = true; return out; }
  const batch = todo.slice(0, MAX_FETCH_PER_CLICK);
  out.left = todo.length - batch.length;
  const guard = { reserve: (sku: string) => reserveCall(db, { organizationId: actor.organizationId, provider: "SOCIALAPIS", sku, userId: actor.id, caps: deps.caps, now }), release: (id: string) => releaseCall(db, id) };
  const save = (prospectId: string, data: Record<string, unknown>) => db.prospectSocial.update({ where: { prospectId }, data });
  for (const [i, t] of batch.entries()) {
    try {
      const r = await deps.provider.fetchPage({ apiKey: key, pageUrl: t.url, guard });
      await save(t.id, { status: "OK", provider: deps.provider.id, pageName: r.name, followers: r.followers, likes: r.likes, lastPostAt: r.lastPostAt, fetchedAt: now, note: r.lastPostAt ? null : "The last post date was not available." });
      out.fetched++;
    } catch (e) {
      if (e instanceof BudgetError) { await save(t.id, { status: "LIMIT", note: e.message }); out.stopped = e.message; out.left += batch.length - i - 1; break; }
      if (!(e instanceof SocialError)) throw e;
      out.failed++;
      await save(t.id, { status: e.kind === "NOT_FOUND" ? "NOT_FOUND" : e.kind === "LIMIT" ? "LIMIT" : "FAILED", note: e.message });
      // A refused key or a provider-side limit would fail every other business the same way, so stop instead of spending more
      if (e.kind === "KEY" || e.kind === "LIMIT") { out.stopped = e.message; out.left += batch.length - i - 1; break; }
    }
  }
  await rescoreProspects(db, actor.organizationId, batch.map((t) => t.id), now);
  return out;
}

export const socialUsage = (db: Db, organizationId: string) => usage(db, organizationId, "SOCIALAPIS", socialCaps());
