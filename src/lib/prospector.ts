// Prospector: find businesses with Google Places, keep them as prospects, let managers review, dismiss and assign them.
// A prospect is not a lead: it becomes one only when sent to the CRM (a later stage), because a lead means someone showed interest.
// Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { BudgetError, canAfford, googleCaps, releaseCall, reserveCall, type Caps } from "./api-budget";
import { normalizeE164, phoneTail, isCountry, countryName } from "./phone";
import { notify, usersWithPermission } from "./notifications";
import { PAGE_SIZE, MAX_RESULTS, PLACES_SKU, PlacesError, searchText, type Place } from "./places";
import { SKU_PRICE_USD } from "./api-budget";

type Db = PrismaClient;
export class ProspectorError extends Error {}

export const PROSPECT_STATUSES = ["NEW", "REVIEWED", "ASSIGNED", "SENT_TO_CRM", "DISMISSED"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
export const RESULT_CHOICES = [20, 40, 60] as const;
export const DEFAULT_DAILY_SEARCHES = 10;

export type Actor = { id: string; organizationId: string; permissions: ReadonlySet<string> };
// A manager sees every prospect and can review, dismiss and assign. Everyone else sees only prospects assigned to them or found by their own searches.
export const isManager = (a: Actor) => a.permissions.has("crm.view_all") && a.permissions.has("crm.edit");
export const canSearch = (a: Actor) => a.permissions.has("prospector.use");
export const prospectScope = (a: Actor): Prisma.ProspectWhereInput =>
  isManager(a) ? { organizationId: a.organizationId } : { organizationId: a.organizationId, OR: [{ assignedToId: a.id }, { search: { userId: a.id } }] };

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const searchQuery = (type: string, city: string, country: string) => `${type} in ${city}, ${countryName(country)}`;
export const estimate = (maxResults: number) => { const requests = Math.ceil(maxResults / PAGE_SIZE); return { requests, costUsd: requests * SKU_PRICE_USD[PLACES_SKU] }; };

// ---------- search limits ----------
export async function dailyLimitFor(db: Db, organizationId: string, userId: string) {
  const [own, def] = await Promise.all([
    db.prospectorUserLimit.findUnique({ where: { organizationId_userId: { organizationId, userId } } }),
    db.prospectorSettings.findUnique({ where: { organizationId } }),
  ]);
  return own?.dailySearches ?? def?.defaultDailySearches ?? DEFAULT_DAILY_SEARCHES;
}
export const searchesToday = (db: Db, organizationId: string, userId: string, now = new Date()) =>
  db.prospectSearch.count({ where: { organizationId, userId, createdAt: { gte: dayStart(now) } } });

export async function setDailyLimits(db: Db, p: { organizationId: string; defaultLimit: number; overrides: { userId: string; limit: number | null }[] }) {
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 500;
  if (!ok(p.defaultLimit)) throw new ProspectorError("The default daily limit must be a whole number from 0 to 500.");
  await db.prospectorSettings.upsert({ where: { organizationId: p.organizationId }, update: { defaultDailySearches: p.defaultLimit }, create: { organizationId: p.organizationId, defaultDailySearches: p.defaultLimit } });
  for (const o of p.overrides) {
    if (o.limit === null) { await db.prospectorUserLimit.deleteMany({ where: { organizationId: p.organizationId, userId: o.userId } }); continue; }
    if (!ok(o.limit)) throw new ProspectorError("A person's daily limit must be a whole number from 0 to 500.");
    // only people in this organization can be given a limit
    if (!(await db.user.findFirst({ where: { id: o.userId, organizationId: p.organizationId }, select: { id: true } }))) continue;
    await db.prospectorUserLimit.upsert({ where: { organizationId_userId: { organizationId: p.organizationId, userId: o.userId } }, update: { dailySearches: o.limit }, create: { organizationId: p.organizationId, userId: o.userId, dailySearches: o.limit } });
  }
}

// ---------- searching ----------
export type SearchInput = { businessType: string; city: string; country: string; maxResults: number };
export type SearchResult = { searchId: string; found: number; added: number; duplicates: number; closed: number; requests: number; costUsd: number; partialError: string | null };

export async function runSearch(db: Db, p: {
  actor: Actor; input: SearchInput; apiKey: string | undefined; caps?: Caps; fetchImpl?: typeof fetch; now?: Date;
}): Promise<SearchResult> {
  const { actor } = p;
  if (!canSearch(actor)) throw new ProspectorError("You do not have search access. Ask a manager to grant it.");
  if (!p.apiKey) throw new ProspectorError("Google Places is not configured. Ask the administrator to set GOOGLE_PLACES_API_KEY on the server.");
  const now = p.now ?? new Date();
  const caps = p.caps ?? googleCaps();
  const businessType = clean(p.input.businessType, 80);
  const city = clean(p.input.city, 80);
  const country = String(p.input.country ?? "").toUpperCase();
  if (businessType.length < 2) throw new ProspectorError("Enter the type of business, for example dentist or restaurant.");
  if (city.length < 2) throw new ProspectorError("Enter a city.");
  if (!isCountry(country)) throw new ProspectorError("Choose a country from the list.");
  if (!(RESULT_CHOICES as readonly number[]).includes(p.input.maxResults)) throw new ProspectorError("Choose 20, 40 or 60 results.");

  const [limit, used] = await Promise.all([dailyLimitFor(db, actor.organizationId, actor.id), searchesToday(db, actor.organizationId, actor.id, now)]);
  if (used >= limit) throw new ProspectorError(`You have used your ${limit} searches for today. A manager can raise your limit.`);

  const est = estimate(Math.min(p.input.maxResults, MAX_RESULTS));
  const afford = await canAfford(db, { organizationId: actor.organizationId, provider: "GOOGLE_PLACES", sku: PLACES_SKU, calls: est.requests, caps, now });
  if (!afford.ok) throw new ProspectorError(afford.reason);

  const query = searchQuery(businessType, city, country);
  const search = await db.prospectSearch.create({ data: { organizationId: actor.organizationId, userId: actor.id, businessType, city, country, query, createdAt: now } });

  const found: Place[] = [];
  const seen = new Set<string>();
  let requests = 0, cost = 0, partialError: string | null = null, token: string | undefined;
  while (found.length < p.input.maxResults && requests < est.requests) {
    let reservation: { id: string; costUsd: number };
    try { reservation = await reserveCall(db, { organizationId: actor.organizationId, provider: "GOOGLE_PLACES", sku: PLACES_SKU, userId: actor.id, caps, now }); }
    catch (e) { if (e instanceof BudgetError) { partialError = e.message; break; } throw e; }
    try {
      const page = await searchText({ apiKey: p.apiKey, textQuery: query, regionCode: country, pageToken: token, fetchImpl: p.fetchImpl });
      requests++; cost += reservation.costUsd;
      for (const pl of page.places) if (!seen.has(pl.placeId)) { seen.add(pl.placeId); found.push(pl); }
      token = page.nextPageToken ?? undefined;
      if (!token) break;
    } catch (e) {
      await releaseCall(db, reservation.id);
      if (e instanceof PlacesError) { partialError = e.message; break; }
      throw e;
    }
  }

  if (requests === 0) { // nothing was bought: leave no trace and do not use up a daily search
    await db.prospectSearch.delete({ where: { id: search.id } });
    throw new ProspectorError(partialError ?? "The search could not be run.");
  }

  const wanted = found.slice(0, p.input.maxResults);
  const { added, duplicates, closed } = await saveProspects(db, { organizationId: actor.organizationId, searchId: search.id, country, city, places: wanted, now });
  await db.prospectSearch.update({ where: { id: search.id }, data: { requests, found: wanted.length, added, duplicates, costUsd: cost, error: partialError } });
  return { searchId: search.id, found: wanted.length, added, duplicates, closed, requests, costUsd: cost, partialError };
}

// Saves what is new. Skipped, and counted as duplicates: places already prospects, businesses that match an existing lead (same phone number
// or same company name) and anyone on the do-not-contact list. Permanently closed places are dropped.
export async function saveProspects(db: Db, p: { organizationId: string; searchId: string; country: string; city: string; places: Place[]; now?: Date }) {
  const org = p.organizationId;
  const [existing, leads, blocked] = await Promise.all([
    db.prospect.findMany({ where: { organizationId: org, placeId: { in: p.places.map((x) => x.placeId) } }, select: { placeId: true } }),
    db.lead.findMany({ where: { organizationId: org }, select: { phone: true, company: true } }),
    db.suppressedContact.findMany({ where: { organizationId: org }, select: { phone: true } }),
  ]);
  const have = new Set(existing.map((e) => e.placeId));
  const leadTails = new Set(leads.map((l) => phoneTail(l.phone)).filter(Boolean) as string[]);
  const leadNames = new Set(leads.map((l) => l.company?.trim().toLowerCase()).filter(Boolean) as string[]);
  const blockedTails = new Set(blocked.map((b) => phoneTail(b.phone)).filter(Boolean) as string[]);
  const rows: Prisma.ProspectCreateManyInput[] = [];
  let duplicates = 0, closed = 0;
  for (const pl of p.places) {
    if (pl.businessStatus === "CLOSED_PERMANENTLY") { closed++; continue; }
    const phone = normalizeE164(pl.internationalPhone, p.country) ?? normalizeE164(pl.nationalPhone, p.country);
    const tail = phoneTail(phone);
    if (have.has(pl.placeId) || (tail && (leadTails.has(tail) || blockedTails.has(tail))) || leadNames.has(pl.name.trim().toLowerCase())) { duplicates++; continue; }
    rows.push({
      organizationId: org, searchId: p.searchId, placeId: pl.placeId, name: pl.name, address: pl.address, city: p.city, country: p.country, phone, website: pl.website, mapsUrl: pl.mapsUrl,
      rating: pl.rating, ratingCount: pl.ratingCount, primaryType: pl.primaryType, businessStatus: pl.businessStatus, placeFetchedAt: p.now ?? new Date(),
    });
  }
  // The unique (organization, place) key makes this safe even if two people find the same business at the same moment
  const made = rows.length ? await db.prospect.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  duplicates += rows.length - made.count;
  return { added: made.count, duplicates, closed };
}

// ---------- review, dismiss, assign (managers) ----------
const LOCKED: ProspectStatus = "SENT_TO_CRM";
async function editable(db: Db, actor: Actor, ids: string[]) {
  if (!isManager(actor)) throw new ProspectorError("Only a sales manager can review, dismiss or assign prospects.");
  const rows = await db.prospect.findMany({ where: { organizationId: actor.organizationId, id: { in: ids } }, select: { id: true, status: true, name: true } });
  return rows.filter((r) => r.status !== LOCKED);
}

export async function markReviewed(db: Db, actor: Actor, ids: string[]) {
  const rows = await editable(db, actor, ids);
  await db.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: { in: ["NEW"] } }, data: { status: "REVIEWED" } });
  return rows.length;
}
export async function dismiss(db: Db, actor: Actor, ids: string[]) {
  const rows = await editable(db, actor, ids);
  await db.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "DISMISSED", assignedToId: null, assignedAt: null } });
  return rows.length;
}
export async function restore(db: Db, actor: Actor, ids: string[]) {
  const rows = await editable(db, actor, ids);
  await db.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "DISMISSED" }, data: { status: "NEW" } });
  return rows.length;
}
export async function assignableAgents(db: Db, organizationId: string) {
  const ids = await usersWithPermission(db, organizationId, "crm.edit");
  return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
export async function assign(db: Db, actor: Actor, ids: string[], agentId: string) {
  const rows = await editable(db, actor, ids);
  const agents = new Set((await assignableAgents(db, actor.organizationId)).map((a) => a.id));
  if (!agents.has(agentId)) throw new ProspectorError("Choose an active sales team member.");
  const now = new Date();
  await db.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "ASSIGNED", assignedToId: agentId, assignedAt: now } });
  if (rows.length > 0 && agentId !== actor.id) {
    await notify(db, agentId, {
      kind: "prospect.assigned", title: rows.length === 1 ? `Prospect assigned to you: ${rows[0].name}` : `${rows.length} prospects assigned to you`, body: "Prospector", link: "/leads/prospector?status=ASSIGNED",
      dedupeKey: `prospect-assigned:${agentId}:${rows.map((r) => r.id).sort().join(",").slice(0, 120)}:${now.getTime()}`,
    });
  }
  return rows.length;
}

// ---------- listing ----------
export const PROSPECT_SORTS = { name: { field: "name" }, rating: { field: "rating", nullable: true }, created: { field: "createdAt" } } as const;
export function prospectWhere(actor: Actor, p: { q?: string; status?: string; searchId?: string }): Prisma.ProspectWhereInput {
  const and: Prisma.ProspectWhereInput[] = [prospectScope(actor)];
  if (p.status) and.push({ status: p.status });
  if (p.searchId) and.push({ searchId: p.searchId });
  if (p.q) { const q = p.q; and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { website: { contains: q, mode: "insensitive" } }] }); }
  return { AND: and };
}
