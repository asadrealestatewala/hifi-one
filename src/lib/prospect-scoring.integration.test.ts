import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rescoreProspects, scoreOne } from "./prospect-scoring";
import { saveProspects } from "./prospector";
import { drainWebsiteChecks, queueChecks } from "./website-checks";
import { fetchFacebookData, setFacebookLink } from "./prospect-social";
import { orderFor } from "./sort";
import { PROSPECT_SORTS, type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, searchId: string, mgr: Actor;
const NOW = new Date("2026-11-04T10:00:00Z");
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const place = (n: number, over: Record<string, unknown> = {}) => ({ placeId: `sc-${n}`, name: `Clinic ${n}`, address: `${n} Mall Road`, phone: null, internationalPhone: `+9230011122${String(n).padStart(2, "0")}`, nationalPhone: null, website: `https://clinic${n}.example`, mapsUrl: null, rating: 4.6, ratingCount: 150, primaryType: "dentist", businessStatus: "OPERATIONAL", ...over });
const row = (placeId: string) => db.prospect.findFirstOrThrow({ where: { organizationId: org, placeId } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectSocial","ProspectWebsiteCheck","ApiCall","Prospect","ProspectSearch","SuppressedContact","Lead","PipelineStage","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Sc Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const m = (await db.user.create({ data: { organizationId: org, email: "m@sc.test", name: "Mona", passwordHash: "x" } })).id;
  const o = (await db.user.create({ data: { organizationId: other, email: "o@sc.test", name: "Olga", passwordHash: "x" } })).id;
  searchId = (await db.prospectSearch.create({ data: { organizationId: org, userId: m, businessType: "dentist", city: "Lahore", country: "PK", query: "q" } })).id;
  await db.prospectSearch.create({ data: { organizationId: other, userId: o, businessType: "dentist", city: "Lahore", country: "PK", query: "q" } });
  mgr = actor(m, org, ["crm.view", "crm.view_all", "crm.edit", "prospector.use", "prospector.manage"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("scores are kept up to date", () => {
  it("a new prospect is scored from its Google listing the moment it is saved", async () => {
    await saveProspects(db, { organizationId: org, searchId, country: "PK", city: "Lahore", places: [place(1, { website: null, ratingCount: 3, rating: 3.4 }), place(2)], now: NOW });
    const noSite = await row("sc-1"), fine = await row("sc-2");
    expect(noSite).toMatchObject({ score: 51, scoreService: "WEBSITE", scoreVersion: 1 }); // no website 35 + 3 reviews 8 + rating 8
    expect(fine.score).toBe(0); // nothing known against them yet: unchecked facts score nothing
    expect(fine.scoredAt).not.toBeNull();
  });
  it("a finished website check changes the score, and a business with no website is scored without any request", async () => {
    const p = await row("sc-2");
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const html = "<html><head></head><body><p>" + "Welcome to our clinic. ".repeat(30) + "</p></body></html>"; // no title, no description, no analytics, no form
    await drainWebsiteChecks(db, { organizationId: org, deps: { fetchPage: async (u) => ({ finalUrl: u, status: 200, html, truncated: false, redirects: 0 }), psiKey: async () => undefined, sleep: async () => undefined } });
    const after = await row("sc-2");
    expect(after.score).toBeGreaterThan(30);
    expect(after.scoreService).toBe("ADS");
    const s = (await scoreOne(db, org, p.id, NOW))!;
    expect(s.reasons.map((r) => r.id)).toEqual(expect.arrayContaining(["NO_TITLE", "NO_ANALYTICS", "NO_CONTACT_FORM", "NO_FACEBOOK"]));
    expect(s.score).toBe(after.score);
    const none = await row("sc-1");
    await queueChecks(db, mgr, [none.id], { now: NOW });
    expect((await row("sc-1")).score).toBe(51);
  });
  it("adding a Facebook link removes the no-Facebook reason, and fetched numbers add their own", async () => {
    const p = await row("sc-2");
    const before = p.score!;
    await setFacebookLink(db, mgr, p.id, "facebook.com/clinic2");
    const withLink = (await row("sc-2")).score!;
    expect(withLink).toBe(before - 10); // NO_FACEBOOK was 10
    const provider = { id: "FAKE", label: "Fake", requestsPerPage: 2, fetchPage: vi.fn(async () => ({ name: "Clinic 2", followers: 80, likes: null, lastPostAt: new Date("2026-05-01T00:00:00Z") })) };
    await fetchFacebookData(db, mgr, [p.id], { now: NOW, deps: { provider, key: async () => "K", caps: { monthlyUsd: 0, dailyCalls: 50, monthlyCalls: 50 } } });
    const s = (await scoreOne(db, org, p.id, NOW))!;
    expect(s.reasons.map((r) => r.id)).toEqual(expect.arrayContaining(["FEW_FOLLOWERS", "STALE_FACEBOOK"]));
    expect((await row("sc-2")).score).toBe(withLink + 8 + 12);
    await setFacebookLink(db, mgr, p.id, "");
    expect((await row("sc-2")).score).toBe(before);
  });
});

describe("scoring again", () => {
  it("rescores only the organization it is asked about, and nobody else's", async () => {
    const o = (await db.prospectSearch.findFirstOrThrow({ where: { organizationId: other } })).id;
    await saveProspects(db, { organizationId: other, searchId: o, country: "PK", city: "Lahore", places: [place(90, { website: null })], now: NOW });
    await db.prospect.updateMany({ where: {}, data: { score: null, scoredAt: null } });
    expect(await rescoreProspects(db, org, null, NOW)).toBe(2);
    expect((await db.prospect.findFirstOrThrow({ where: { organizationId: other } })).score).toBeNull();
    expect((await db.prospect.findMany({ where: { organizationId: org } })).every((p) => p.score !== null)).toBe(true);
  });
  it("does nothing for an empty list, and scoreOne does not reach another organization", async () => {
    expect(await rescoreProspects(db, org, [], NOW)).toBe(0);
    const foreign = await db.prospect.findFirstOrThrow({ where: { organizationId: other } });
    expect(await scoreOne(db, org, foreign.id, NOW)).toBeNull();
    expect(await rescoreProspects(db, org, [foreign.id], NOW)).toBe(0);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: foreign.id } })).score).toBeNull();
  });
  it("lists best first, with unscored rows last", async () => {
    await db.prospect.update({ where: { organizationId_placeId: { organizationId: org, placeId: "sc-2" } }, data: { score: null } });
    const rows = await db.prospect.findMany({ where: { organizationId: org }, orderBy: orderFor({ key: "score", dir: "desc" }, PROSPECT_SORTS) });
    expect(rows.map((r) => r.placeId)).toEqual(["sc-1", "sc-2"]);
  });
});
