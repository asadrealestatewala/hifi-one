import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { BudgetError, googleCaps, reserveCall, usage } from "./api-budget";
import { assign, dismiss, dailyLimitFor, markReviewed, prospectWhere, runSearch, setDailyLimits, ProspectorError, type Actor } from "./prospector";
import { PLACES_SKU } from "./places";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, mgr: Actor, agent: Actor, agent2: Actor, nobody: Actor, otherOrg: Actor;
const NOW = new Date("2026-11-03T10:00:00Z");
const CAPS = { monthlyUsd: 20, dailyCalls: 100 };

const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const place = (n: number, over: Record<string, unknown> = {}) => ({ id: `pl${n}`, displayName: { text: `Clinic ${n}` }, formattedAddress: `${n} Mall Road, Lahore`, internationalPhoneNumber: `+92 300 11122${String(n).padStart(2, "0")}`, websiteUri: `https://clinic${n}.example`, rating: 4.2, userRatingCount: n, ...over });
const page = (ids: number[], next?: string, over: Record<string, unknown> = {}) => new Response(JSON.stringify({ places: ids.map((n) => place(n, over)), ...(next ? { nextPageToken: next } : {}) }), { status: 200 });
const input = { businessType: "dentist", city: "Lahore", country: "PK", maxResults: 20 };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectorUserLimit","ProspectorSettings","ApiCall","Prospect","ProspectSearch","SuppressedContact","Notification","LeadActivity","Lead","PipelineStage","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "P Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [m, a, a2, n, o] = await Promise.all([mk(org, "m@p.test", "Mona Manager"), mk(org, "a@p.test", "Ali Agent"), mk(org, "a2@p.test", "Zara Agent"), mk(org, "n@p.test", "Nina None"), mk(other, "o@p.test", "Olga")]);
  const crmEdit = await db.permission.create({ data: { key: "crm.edit", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "SALES", name: "Sales" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: crmEdit.id } });
  for (const u of [m, a, a2]) await db.userRole.create({ data: { userId: u, roleId: role.id } });
  mgr = actor(m, org, ["crm.view", "crm.view_all", "crm.edit", "prospector.use", "prospector.manage"]);
  agent = actor(a, org, ["crm.view", "crm.edit", "prospector.use"]);
  agent2 = actor(a2, org, ["crm.view", "crm.edit"]);
  nobody = actor(n, org, ["crm.view"]);
  otherOrg = actor(o, other, ["crm.view", "crm.view_all", "crm.edit", "prospector.use"]);
});
afterAll(async () => { await db.$disconnect(); });
const run = (a: Actor, fetchImpl: unknown, over: Partial<typeof input> = {}, key: string | null = "KEY") => runSearch(db, { actor: a, input: { ...input, ...over }, apiKey: key ?? undefined, caps: CAPS, fetchImpl: fetchImpl as never, now: NOW });

describe("searching", () => {
  it("saves prospects with international phones, charges the ledger and reports the cost", async () => {
    const f = vi.fn().mockResolvedValue(page([1, 2, 3]));
    const r = await run(mgr, f);
    expect(r).toMatchObject({ found: 3, added: 3, duplicates: 0, requests: 1 });
    expect(r.costUsd).toBeCloseTo(0.035, 5);
    const p = await db.prospect.findFirstOrThrow({ where: { placeId: "pl1" } });
    expect(p).toMatchObject({ phone: "+923001112201", status: "NEW", country: "PK", city: "Lahore", organizationId: org });
    const u = await usage(db, org, "GOOGLE_PLACES", CAPS, NOW);
    expect(u.monthSpentUsd).toBeCloseTo(0.035, 5);
    expect(u.dayCalls).toBe(1);
  });
  it("does not add a business twice, and counts it as a duplicate", async () => {
    const r = await run(mgr, vi.fn().mockResolvedValue(page([2, 3, 4])));
    expect(r).toMatchObject({ found: 3, added: 1, duplicates: 2 });
    expect(await db.prospect.count({ where: { organizationId: org } })).toBe(4);
  });
  it("skips businesses that match an existing lead or the do-not-contact list, and permanently closed ones", async () => {
    const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
    await db.lead.create({ data: { organizationId: org, name: "Known Lead", phone: "0300-1112210", stageId: stage.id } });
    await db.lead.create({ data: { organizationId: org, name: "Owner", company: "clinic 11", stageId: stage.id } });
    await db.suppressedContact.create({ data: { organizationId: org, phone: "+92 300 1112212" } });
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [place(10), place(11), place(12), place(13, { businessStatus: "CLOSED_PERMANENTLY" }), place(14)] })));
    const r = await run(mgr, f);
    expect(r).toMatchObject({ added: 1, duplicates: 3, closed: 1 });
    expect((await db.prospect.findMany({ where: { placeId: { in: ["pl10", "pl11", "pl12", "pl13", "pl14"] } } })).map((p) => p.placeId)).toEqual(["pl14"]);
  });
  it("follows next-page tokens up to the number of results asked for", async () => {
    const f = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => 100 + i), "T1")).mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => 120 + i)));
    const r = await run(mgr, f, { maxResults: 40 } as never);
    expect(r).toMatchObject({ found: 40, added: 40, requests: 2 });
    expect(JSON.parse(f.mock.calls[1][1].body).pageToken).toBe("T1");
  });
  it("leaves no trace and spends nothing when Google refuses the first request", async () => {
    const before = await db.apiCall.count();
    const searches = await db.prospectSearch.count();
    await expect(run(mgr, vi.fn().mockResolvedValue(new Response("{}", { status: 403 })), { city: "Karachi" })).rejects.toThrow(/refused/);
    expect(await db.apiCall.count()).toBe(before);
    expect(await db.prospectSearch.count()).toBe(searches);
  });
  it("keeps what it got and says so when a later request fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(page([200, 201], "T")).mockResolvedValueOnce(new Response("{}", { status: 429 }));
    const r = await run(mgr, f, { maxResults: 40, city: "Multan" } as never);
    expect(r.added).toBe(2);
    expect(r.partialError).toMatch(/limiting/);
    expect(r.requests).toBe(1);
  });
  it("refuses people without search access, without a key, and with bad input", async () => {
    const f = vi.fn();
    await expect(run(agent2, f)).rejects.toThrow(/search access/);
    await expect(run(nobody, f)).rejects.toThrow(/search access/);
    await expect(run(mgr, f, {}, null)).rejects.toThrow(/not configured/);
    await expect(run(mgr, f, { country: "ZZ" })).rejects.toThrow(/country/);
    await expect(run(mgr, f, { businessType: "" })).rejects.toThrow(/type of business/);
    await expect(run(mgr, f, { maxResults: 500 } as never)).rejects.toThrow(/20, 40 or 60/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("budget guard", () => {
  it("refuses a call past the monthly cap, records nothing, and never overruns when callers race", async () => {
    await db.apiCall.deleteMany({});
    const caps = { monthlyUsd: 0.1, dailyCalls: 100 }; // room for two calls at $0.035
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserveCall(db, { organizationId: org, provider: "GOOGLE_PLACES", sku: PLACES_SKU, caps, now: NOW })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BudgetError)).toBe(true);
    expect((await usage(db, org, "GOOGLE_PLACES", caps, NOW)).monthSpentUsd).toBeLessThanOrEqual(0.1);
  });
  it("enforces the daily call limit and refuses a whole search that would not fit, before any request", async () => {
    await db.apiCall.deleteMany({});
    const f = vi.fn().mockResolvedValue(page([300]));
    await expect(runSearch(db, { actor: mgr, input: { ...input, city: "Quetta", maxResults: 60 }, apiKey: "K", caps: { monthlyUsd: 0.05, dailyCalls: 100 }, fetchImpl: f as never, now: NOW })).rejects.toThrow(/monthly Google budget/);
    await expect(runSearch(db, { actor: mgr, input: { ...input, city: "Quetta", maxResults: 60 }, apiKey: "K", caps: { monthlyUsd: 20, dailyCalls: 2 }, fetchImpl: f as never, now: NOW })).rejects.toThrow(/daily limit/);
    expect(f).not.toHaveBeenCalled();
  });
  it("counts the month from the first of the month and reads caps from the environment", async () => {
    await db.apiCall.deleteMany({});
    await db.apiCall.create({ data: { organizationId: org, provider: "GOOGLE_PLACES", sku: PLACES_SKU, costUsd: 5, createdAt: new Date("2026-10-31T23:00:00Z") } });
    expect((await usage(db, org, "GOOGLE_PLACES", CAPS, NOW)).monthSpentUsd).toBe(0);
    expect(googleCaps({ GOOGLE_MONTHLY_BUDGET_USD: "7.5", GOOGLE_DAILY_CALL_LIMIT: "12" })).toEqual({ monthlyUsd: 7.5, dailyCalls: 12 });
    expect(googleCaps({})).toEqual({ monthlyUsd: 20, dailyCalls: 100 });
    expect(googleCaps({ GOOGLE_MONTHLY_BUDGET_USD: "abc" }).monthlyUsd).toBe(20);
  });
});

describe("daily search limits", () => {
  it("stops a person at their limit, with a default and a per-person override", async () => {
    await db.apiCall.deleteMany({}); await db.prospectSearch.deleteMany({});
    expect(await dailyLimitFor(db, org, agent.id)).toBe(10);
    await setDailyLimits(db, { organizationId: org, defaultLimit: 2, overrides: [] });
    const f = () => vi.fn().mockImplementation(async () => page([Math.floor(Math.random() * 1e6)]));
    await run(agent, f(), { city: "A1" }); await run(agent, f(), { city: "A2" });
    await expect(run(agent, f(), { city: "A3" })).rejects.toThrow(/2 searches for today/);
    await setDailyLimits(db, { organizationId: org, defaultLimit: 2, overrides: [{ userId: agent.id, limit: 3 }] });
    await expect(run(agent, f(), { city: "A3" })).resolves.toBeTruthy();
    await setDailyLimits(db, { organizationId: org, defaultLimit: 2, overrides: [{ userId: agent.id, limit: null }] });
    expect(await dailyLimitFor(db, org, agent.id)).toBe(2);
    await expect(setDailyLimits(db, { organizationId: org, defaultLimit: -1, overrides: [] })).rejects.toBeInstanceOf(ProspectorError);
  });
});

describe("who sees and changes what", () => {
  beforeAll(async () => {
    await db.prospectSearch.deleteMany({}); await db.prospectorSettings.deleteMany({}); await db.prospectorUserLimit.deleteMany({}); await db.apiCall.deleteMany({});
    await run(mgr, vi.fn().mockResolvedValue(page([400, 401, 402, 403])), { city: "Seeded" });
    await run(agent, vi.fn().mockResolvedValue(page([410, 411])), { city: "Agent's" });
  });
  it("managers see everything in their organization; agents see only their own searches and assignments; other organizations see nothing", async () => {
    const all = await db.prospect.findMany({ where: prospectWhere(mgr, {}) });
    expect(all.length).toBeGreaterThan(5);
    const mine = await db.prospect.findMany({ where: prospectWhere(agent, {}) });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(await db.prospect.count({ where: prospectWhere(agent2, {}) })).toBe(0);
    expect(await db.prospect.count({ where: prospectWhere(otherOrg, {}) })).toBe(0);
  });
  it("lets only a manager review, dismiss and assign, and tells the agent", async () => {
    const [p1, p2] = await db.prospect.findMany({ where: { organizationId: org, assignedToId: null, status: "NEW" }, take: 2, orderBy: { id: "asc" } });
    await expect(assign(db, agent, [p1.id], agent.id)).rejects.toThrow(/sales manager/);
    await expect(markReviewed(db, agent2, [p1.id])).rejects.toThrow(/sales manager/);
    await expect(assign(db, mgr, [p1.id], "not-a-user")).rejects.toThrow(/sales team member/);
    expect(await assign(db, otherOrg, [p1.id], agent.id).catch(() => -1)).toBe(-1); // wrong organization: not a manager of this one
    expect(await markReviewed(db, mgr, [p1.id])).toBe(1);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe("REVIEWED");
    expect(await assign(db, mgr, [p1.id, p2.id], agent2.id)).toBe(2);
    const a = await db.prospect.findUniqueOrThrow({ where: { id: p1.id } });
    expect(a).toMatchObject({ status: "ASSIGNED", assignedToId: agent2.id });
    expect(await db.notification.count({ where: { userId: agent2.id, kind: "prospect.assigned" } })).toBe(1);
    expect(await db.prospect.count({ where: prospectWhere(agent2, {}) })).toBe(2);
    expect(await dismiss(db, mgr, [p2.id])).toBe(1);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: p2.id } })).toMatchObject({ status: "DISMISSED", assignedToId: null });
  });
  it("never changes a prospect that was already sent to the CRM, or one from another organization", async () => {
    const p = await db.prospect.findFirstOrThrow({ where: { organizationId: org, status: "NEW" } });
    await db.prospect.update({ where: { id: p.id }, data: { status: "SENT_TO_CRM" } });
    expect(await dismiss(db, mgr, [p.id])).toBe(0);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("SENT_TO_CRM");
    const foreign = await db.prospect.findFirstOrThrow({ where: { organizationId: org, status: "NEW" } });
    expect(await dismiss(db, otherOrg, [foreign.id])).toBe(0);
  });
});
