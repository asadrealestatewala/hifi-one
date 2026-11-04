import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MAX_FETCH_PER_CLICK, SocialAccessError, fetchFacebookData, recordDiscoveredLink, setFacebookLink, type SocialDeps } from "./prospect-social";
import { SocialError, type SocialProvider } from "./social";
import { drainWebsiteChecks, queueChecks } from "./website-checks";
import { usage } from "./api-budget";
import type { Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, mgr: Actor, agent: Actor, agent2: Actor, nobody: Actor, otherOrg: Actor;
const NOW = new Date("2026-11-04T10:00:00Z");
const CAPS = { monthlyUsd: 0, dailyCalls: 10, monthlyCalls: 20 };
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const FB = "https://www.facebook.com/smiledental";

// A provider that makes two ledger reservations per business, like the real one, so the caps are exercised
function provider(before?: (p: Parameters<SocialProvider["fetchPage"]>[0]) => Promise<void>): SocialProvider {
  return {
    id: "FAKE", label: "Fake", requestsPerPage: 2,
    fetchPage: vi.fn(async (p) => {
      await before?.(p);
      await p.guard.reserve("SOCIAL_FB_PAGE_DETAILS"); await p.guard.reserve("SOCIAL_FB_PAGE_POSTS");
      return { name: "Smile Dental", followers: 4100, likes: 3900, lastPostAt: new Date("2026-10-30T10:00:00Z") };
    }),
  };
}
const deps = (over: Partial<SocialDeps> = {}): Partial<SocialDeps> => ({ provider: provider(), key: vi.fn(async () => "KEY"), caps: CAPS, ...over });

let n = 0;
async function prospect(organizationId: string, over: Record<string, unknown> = {}, social: Record<string, unknown> | null = { facebookUrl: FB, source: "WEBSITE" }) {
  const k = ++n;
  const s = await db.prospectSearch.findFirstOrThrow({ where: { organizationId } });
  const p = await db.prospect.create({ data: { organizationId, searchId: s.id, placeId: `ps-${organizationId}-${k}`, name: `Clinic ${k}`, website: `https://clinic${k}.example`, ...over } });
  if (social) await db.prospectSocial.create({ data: { prospectId: p.id, organizationId, ...social } as never });
  return p;
}
const soc = (id: string) => db.prospectSocial.findUniqueOrThrow({ where: { prospectId: id } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectSocial","ProspectWebsiteCheck","ProspectorUserLimit","ProspectorSettings","ApiCall","Prospect","ProspectSearch","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "S Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [m, a, a2, nb, o] = await Promise.all([mk(org, "m@s.test", "Mona"), mk(org, "a@s.test", "Ali"), mk(org, "a2@s.test", "Zara"), mk(org, "n@s.test", "Nina"), mk(other, "o@s.test", "Olga")]);
  for (const [organizationId, userId] of [[org, m], [other, o]] as const) await db.prospectSearch.create({ data: { organizationId, userId, businessType: "dentist", city: "Lahore", country: "PK", query: "dentist in Lahore" } });
  mgr = actor(m, org, ["crm.view", "crm.view_all", "crm.edit", "prospector.use", "prospector.manage"]);
  agent = actor(a, org, ["crm.view", "crm.edit", "prospector.use"]);
  agent2 = actor(a2, org, ["crm.view", "crm.edit", "prospector.use"]);
  nobody = actor(nb, org, ["crm.view"]);
  otherOrg = actor(o, other, ["crm.view", "crm.view_all", "crm.edit", "prospector.use"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("Facebook address", () => {
  it("is saved from a website, and a later find does not replace one a person typed", async () => {
    const p = await prospect(org, {}, null);
    await recordDiscoveredLink(db, { prospectId: p.id, organizationId: org, url: FB });
    expect(await soc(p.id)).toMatchObject({ facebookUrl: FB, source: "WEBSITE", status: "NOT_FETCHED" });
    await setFacebookLink(db, mgr, p.id, "facebook.com/mine.page");
    expect(await soc(p.id)).toMatchObject({ facebookUrl: "https://www.facebook.com/mine.page", source: "MANUAL" });
    await recordDiscoveredLink(db, { prospectId: p.id, organizationId: org, url: "https://www.facebook.com/other.page" });
    expect((await soc(p.id)).facebookUrl).toBe("https://www.facebook.com/mine.page");
  });
  it("is cleared of old numbers when the address changes, and nothing is written for no address", async () => {
    const p = await prospect(org, {}, { facebookUrl: FB, source: "WEBSITE", status: "OK", followers: 5, fetchedAt: NOW });
    await recordDiscoveredLink(db, { prospectId: p.id, organizationId: org, url: FB });
    expect((await soc(p.id)).followers).toBe(5); // same address: kept
    await recordDiscoveredLink(db, { prospectId: p.id, organizationId: org, url: "https://www.facebook.com/new.page" });
    expect(await soc(p.id)).toMatchObject({ facebookUrl: "https://www.facebook.com/new.page", followers: null, status: "NOT_FETCHED" });
    const q = await prospect(org, {}, null);
    await recordDiscoveredLink(db, { prospectId: q.id, organizationId: org, url: null });
    expect(await db.prospectSocial.count({ where: { prospectId: q.id } })).toBe(0);
  });
  it("refuses an address that is not a Facebook page, someone without access, and a prospect they cannot see", async () => {
    const p = await prospect(org, { assignedToId: agent2.id }, null);
    await expect(setFacebookLink(db, mgr, p.id, "https://evil.example/facebook.com/x")).rejects.toThrow(/not the address of a Facebook page/);
    await expect(setFacebookLink(db, nobody, p.id, FB)).rejects.toBeInstanceOf(SocialAccessError);
    await expect(setFacebookLink(db, agent, p.id, FB)).rejects.toThrow(/not available/);
    await expect(setFacebookLink(db, otherOrg, p.id, FB)).rejects.toThrow(/not available/);
    expect(await db.prospectSocial.count({ where: { prospectId: p.id } })).toBe(0);
  });
  it("can be removed by saving it empty", async () => {
    const p = await prospect(org);
    expect(await setFacebookLink(db, mgr, p.id, "  ")).toBeNull();
    expect(await db.prospectSocial.count({ where: { prospectId: p.id } })).toBe(0);
  });
  it("is found by a real website check of a home page that links to it", async () => {
    const p = await prospect(org, {}, null);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const html = `<html><head><title>T</title></head><body><a href="https://www.facebook.com/smiledental/">Facebook</a></body></html>`;
    await drainWebsiteChecks(db, { organizationId: org, deps: { fetchPage: async (u) => ({ finalUrl: u, status: 200, html, truncated: false, redirects: 0 }), psiKey: async () => undefined, sleep: async () => undefined } });
    expect(await soc(p.id)).toMatchObject({ facebookUrl: FB, source: "WEBSITE" });
  });
});

describe("getting the numbers", () => {
  it("refuses someone without access and ignores prospects they cannot see", async () => {
    const mine = await prospect(org, { assignedToId: agent.id }), theirs = await prospect(org, { assignedToId: agent2.id });
    await expect(fetchFacebookData(db, nobody, [mine.id], { now: NOW, deps: deps() })).rejects.toBeInstanceOf(SocialAccessError);
    const d = deps();
    const r = await fetchFacebookData(db, agent, [mine.id, theirs.id], { now: NOW, deps: d });
    expect(r).toMatchObject({ fetched: 1, skipped: 1 });
    expect((await soc(theirs.id)).status).toBe("NOT_FETCHED");
    const foreign = await prospect(other);
    expect(await fetchFacebookData(db, mgr, [foreign.id], { now: NOW, deps: deps() })).toMatchObject({ fetched: 0, skipped: 1 });
  });
  it("saves followers, likes and the last post date, and charges two requests to the ledger", async () => {
    await db.apiCall.deleteMany({});
    const p = await prospect(org);
    const r = await fetchFacebookData(db, mgr, [p.id], { now: NOW, deps: deps() });
    expect(r).toMatchObject({ fetched: 1, failed: 0, noLink: 0 });
    const s = await soc(p.id);
    expect(s).toMatchObject({ status: "OK", provider: "FAKE", pageName: "Smile Dental", followers: 4100, likes: 3900, note: null });
    expect(s.lastPostAt?.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect((await usage(db, org, "SOCIALAPIS", CAPS, NOW)).monthCalls).toBe(2);
  });
  it("makes no request for a prospect without an address, and none for fresh data unless forced", async () => {
    const none = await prospect(org, {}, null);
    const fresh = await prospect(org, {}, { facebookUrl: FB, source: "WEBSITE", status: "OK", followers: 1, fetchedAt: new Date(NOW.getTime() - 86_400_000) });
    const d = deps();
    expect(await fetchFacebookData(db, mgr, [none.id, fresh.id], { now: NOW, deps: d })).toMatchObject({ fetched: 0, noLink: 1, fresh: 1 });
    expect(d.provider!.fetchPage).not.toHaveBeenCalled();
    expect(await fetchFacebookData(db, mgr, [fresh.id], { now: NOW, force: true, deps: d })).toMatchObject({ fetched: 1 });
    const old = await prospect(org, {}, { facebookUrl: FB, source: "WEBSITE", status: "OK", followers: 1, fetchedAt: new Date(NOW.getTime() - 8 * 86_400_000) });
    expect(await fetchFacebookData(db, mgr, [old.id], { now: NOW, deps: d })).toMatchObject({ fetched: 1 });
  });
  it("says so when no key is saved and calls nothing", async () => {
    const p = await prospect(org);
    const d = deps({ key: vi.fn(async () => undefined) });
    expect(await fetchFacebookData(db, mgr, [p.id], { now: NOW, deps: d })).toMatchObject({ notConfigured: true, fetched: 0 });
    expect(d.provider!.fetchPage).not.toHaveBeenCalled();
  });
  it("takes at most five businesses per click and reports how many are left", async () => {
    await db.apiCall.deleteMany({});
    const ps = await Promise.all(Array.from({ length: 7 }, () => prospect(org)));
    const r = await fetchFacebookData(db, mgr, ps.map((p) => p.id), { now: NOW, deps: deps({ caps: { monthlyUsd: 0, dailyCalls: 100, monthlyCalls: 100 } }) });
    expect(r).toMatchObject({ fetched: MAX_FETCH_PER_CLICK, left: 2 });
  });
  it("records a page that was not found, and a failure, without losing earlier numbers", async () => {
    await db.apiCall.deleteMany({});
    const a = await prospect(org), b = await prospect(org, {}, { facebookUrl: FB, source: "WEBSITE", status: "OK", followers: 77, fetchedAt: new Date(NOW.getTime() - 9 * 86_400_000) });
    const nf = provider(async () => { throw new SocialError("SocialAPIs could not find that Facebook page.", "NOT_FOUND"); });
    await fetchFacebookData(db, mgr, [a.id], { now: NOW, deps: deps({ provider: nf }) });
    expect(await soc(a.id)).toMatchObject({ status: "NOT_FOUND", note: "SocialAPIs could not find that Facebook page." });
    const bad = provider(async () => { throw new SocialError("SocialAPIs failed (500).", "FAILED"); });
    await fetchFacebookData(db, mgr, [b.id], { now: NOW, deps: deps({ provider: bad }) });
    expect(await soc(b.id)).toMatchObject({ status: "FAILED", followers: 77 });
  });
  it("stops at the first refused key instead of trying every business", async () => {
    await db.apiCall.deleteMany({});
    const ps = await Promise.all(Array.from({ length: 3 }, () => prospect(org)));
    const refused = provider(async () => { throw new SocialError("SocialAPIs refused the key. Check the key in Integrations.", "KEY"); });
    const r = await fetchFacebookData(db, mgr, ps.map((p) => p.id), { now: NOW, deps: deps({ provider: refused }) });
    expect(r).toMatchObject({ failed: 1, left: 2 });
    expect(r.stopped).toMatch(/refused the key/);
    expect(refused.fetchPage).toHaveBeenCalledTimes(1);
  });
  it("stops when the monthly limit is used up, never passing it", async () => {
    await db.apiCall.deleteMany({});
    const ps = await Promise.all(Array.from({ length: 4 }, () => prospect(org)));
    const caps = { monthlyUsd: 0, dailyCalls: 100, monthlyCalls: 5 };
    const r = await fetchFacebookData(db, mgr, ps.map((p) => p.id), { now: NOW, deps: deps({ caps }) });
    expect(r.stopped).toMatch(/monthly limit of 5 SocialAPIs requests/);
    expect((await usage(db, org, "SOCIALAPIS", caps, NOW)).monthCalls).toBeLessThanOrEqual(5);
    const states = await Promise.all(ps.map((p) => soc(p.id)));
    expect(states.some((s) => s.status === "LIMIT")).toBe(true);
  });
  it("counts each organization's requests separately", async () => {
    await db.apiCall.deleteMany({});
    const mine = await prospect(org), theirs = await prospect(other);
    await fetchFacebookData(db, mgr, [mine.id], { now: NOW, deps: deps() });
    await fetchFacebookData(db, otherOrg, [theirs.id], { now: NOW, deps: deps() });
    expect((await usage(db, org, "SOCIALAPIS", CAPS, NOW)).monthCalls).toBe(2);
    expect((await usage(db, other, "SOCIALAPIS", CAPS, NOW)).monthCalls).toBe(2);
  });
});
