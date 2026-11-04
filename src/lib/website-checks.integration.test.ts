import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { drainWebsiteChecks, queueChecks, runWebsiteChecks, type Deps } from "./website-checks";
import { SafeFetchError } from "./safe-fetch";
import { PageSpeedError } from "./pagespeed";
import { usage } from "./api-budget";
import type { Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, mgr: Actor, agent: Actor, agent2: Actor, nobody: Actor, otherOrg: Actor;
const NOW = new Date("2026-11-04T10:00:00Z");
const CAPS = { monthlyUsd: 0, dailyCalls: 5 };
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });

const GOOD_HTML = `<html><head><title>Smile Dental</title><meta name="description" content="Dentist in Lahore"><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script></head><body><p>${"Welcome to our clinic. ".repeat(30)}</p><form><input type="email" name="email"><textarea name="message"></textarea></form></body></html>`;
const psi = { mobileScore: 62, seoScore: 90, fcpMs: 1800, lcpMs: 3400, tbtMs: 250, cls: 0.12, speedIndexMs: 3000 };
const deps = (over: Partial<Deps> = {}): Partial<Deps> => ({
  fetchPage: vi.fn(async (u: string) => ({ finalUrl: u.startsWith("http") ? u : `https://${u}/`, status: 200, html: GOOD_HTML, truncated: false, redirects: 0 })),
  pageSpeed: vi.fn(async () => psi),
  psiKey: vi.fn(async () => "KEY"),
  sleep: vi.fn(async () => undefined),
  caps: CAPS,
  ...over,
});
let n = 0;
async function prospect(organizationId: string, over: Record<string, unknown> = {}) {
  const k = ++n;
  const s = await db.prospectSearch.findFirstOrThrow({ where: { organizationId } });
  return db.prospect.create({ data: { organizationId, searchId: s.id, placeId: `pl-${organizationId}-${k}`, name: `Clinic ${k}`, website: `https://clinic${k}.example`, ...over } });
}
const check = (id: string) => db.prospectWebsiteCheck.findUniqueOrThrow({ where: { prospectId: id } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectWebsiteCheck","ProspectorUserLimit","ProspectorSettings","ApiCall","Prospect","ProspectSearch","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "W Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [m, a, a2, nb, o] = await Promise.all([mk(org, "m@w.test", "Mona"), mk(org, "a@w.test", "Ali"), mk(org, "a2@w.test", "Zara"), mk(org, "n@w.test", "Nina"), mk(other, "o@w.test", "Olga")]);
  for (const [organizationId, userId] of [[org, m], [other, o]] as const) await db.prospectSearch.create({ data: { organizationId, userId, businessType: "dentist", city: "Lahore", country: "PK", query: "dentist in Lahore" } });
  mgr = actor(m, org, ["crm.view", "crm.view_all", "crm.edit", "prospector.use", "prospector.manage"]);
  agent = actor(a, org, ["crm.view", "crm.edit", "prospector.use"]);
  agent2 = actor(a2, org, ["crm.view", "crm.edit", "prospector.use"]);
  nobody = actor(nb, org, ["crm.view"]);
  otherOrg = actor(o, other, ["crm.view", "crm.view_all", "crm.edit", "prospector.use"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("queueing", () => {
  it("refuses someone without prospector access", async () => {
    const p = await prospect(org);
    await expect(queueChecks(db, nobody, [p.id], { now: NOW })).rejects.toThrow(/access/);
    expect(await db.prospectWebsiteCheck.count({ where: { prospectId: p.id } })).toBe(0);
  });
  it("queues a prospect with a website and marks one without a website straight away", async () => {
    const a = await prospect(org), b = await prospect(org, { website: null });
    const r = await queueChecks(db, mgr, [a.id, b.id], { now: NOW });
    expect(r).toMatchObject({ queued: 1, noWebsite: 1 });
    expect((await check(a.id)).status).toBe("QUEUED");
    expect((await check(b.id)).status).toBe("NO_WEBSITE");
  });
  it("does not queue one that is already waiting, and ignores other organizations' prospects", async () => {
    const a = await prospect(org), foreign = await prospect(other);
    await queueChecks(db, mgr, [a.id], { now: NOW });
    const again = await queueChecks(db, mgr, [a.id, foreign.id], { now: NOW });
    expect(again).toMatchObject({ queued: 0, busy: 1, skipped: 1 });
    expect(await db.prospectWebsiteCheck.count({ where: { prospectId: foreign.id } })).toBe(0);
  });
  it("lets an agent check only prospects assigned to them", async () => {
    const mine = await prospect(org, { assignedToId: agent.id }), theirs = await prospect(org, { assignedToId: agent2.id });
    const r = await queueChecks(db, agent, [mine.id, theirs.id], { now: NOW });
    expect(r).toMatchObject({ queued: 1, skipped: 1 });
    expect(await db.prospectWebsiteCheck.count({ where: { prospectId: theirs.id } })).toBe(0);
  });
  it("skips dismissed prospects", async () => {
    const p = await prospect(org, { status: "DISMISSED" });
    expect(await queueChecks(db, mgr, [p.id], { now: NOW })).toMatchObject({ queued: 0, skipped: 1 });
  });
});

describe("running", () => {
  it("reads the page, scores it and stores the result", async () => {
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const d = deps();
    const r = await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: d });
    expect(r.done).toBeGreaterThanOrEqual(1);
    expect(await check(p.id)).toMatchObject({ status: "DONE", reachable: true, https: true, hasTitle: true, hasMetaDescription: true, hasAnalytics: true, hasMetaPixel: false, hasContactForm: true, hasWhatsapp: false, psiStatus: "OK", mobileScore: 62, seoScore: 90, lcpMs: 3400, error: null });
  });
  it("is fresh for a week unless forced", async () => {
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: deps() });
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    expect(await queueChecks(db, mgr, [p.id], { now: later })).toMatchObject({ queued: 0, fresh: 1 });
    expect(await queueChecks(db, mgr, [p.id], { now: later, force: true })).toMatchObject({ queued: 1 });
    const muchLater = new Date(NOW.getTime() + 8 * 86_400_000);
    await db.prospectWebsiteCheck.update({ where: { prospectId: p.id }, data: { status: "DONE" } });
    expect(await queueChecks(db, mgr, [p.id], { now: muchLater })).toMatchObject({ queued: 1 });
  });
  it("records a site that is down as unreachable and skips PageSpeed for it", async () => {
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const d = deps({ fetchPage: vi.fn(async () => { throw new SafeFetchError("The website could not be reached.", "BLOCKED"); }) });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: d });
    expect(await check(p.id)).toMatchObject({ status: "DONE", reachable: false, error: "The website could not be reached.", psiStatus: null });
    expect(d.pageSpeed).not.toHaveBeenCalled();
  });
  it("tries a passing network problem once more, then gives the result", async () => {
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const d = deps({ fetchPage: vi.fn(async () => { throw new SafeFetchError("The website could not be reached.", "NETWORK"); }) });
    const r1 = await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: d });
    expect(r1.requeued).toBe(1);
    expect((await check(p.id)).status).toBe("QUEUED");
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: d });
    expect(await check(p.id)).toMatchObject({ status: "DONE", reachable: false });
  });
  it("treats 403 as a refused check, not as a dead site, and an error page as unreachable", async () => {
    const a = await prospect(org), b = await prospect(org);
    await queueChecks(db, mgr, [a.id, b.id], { now: NOW });
    const fetchPage = vi.fn(async (u: string) => ({ finalUrl: u, status: u.includes(String(a.website).replace("https://", "")) ? 403 : 500, html: "", truncated: false, redirects: 0 }));
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: deps({ fetchPage }) });
    expect(await check(a.id)).toMatchObject({ status: "DONE", reachable: null, httpStatus: 403 });
    expect((await check(a.id)).error).toMatch(/refused/);
    expect(await check(b.id)).toMatchObject({ status: "DONE", reachable: false, httpStatus: 500 });
  });
  it("says so when no PageSpeed key is saved, and does not call Google", async () => {
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    const d = deps({ psiKey: vi.fn(async () => undefined) });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: d });
    expect(await check(p.id)).toMatchObject({ status: "DONE", psiStatus: "NOT_CONFIGURED", mobileScore: null });
    expect(d.pageSpeed).not.toHaveBeenCalled();
  });
  it("releases the reserved call when Google rejects the key", async () => {
    await db.apiCall.deleteMany({ where: { organizationId: org, provider: "GOOGLE_PAGESPEED" } });
    const p = await prospect(org);
    await queueChecks(db, mgr, [p.id], { now: NOW });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: deps({ pageSpeed: vi.fn(async () => { throw new PageSpeedError("The PageSpeed key was refused.", "KEY"); }) }) });
    expect((await check(p.id)).psiStatus).toBe("FAILED");
    expect((await usage(db, org, "GOOGLE_PAGESPEED", CAPS, NOW)).dayCalls).toBe(0);
  });
  it("stops asking Google once the daily limit is used up", async () => {
    await db.apiCall.deleteMany({ where: { organizationId: org, provider: "GOOGLE_PAGESPEED" } });
    const ps = await Promise.all(Array.from({ length: 7 }, () => prospect(org)));
    await queueChecks(db, mgr, ps.map((p) => p.id), { now: NOW });
    const d = deps();
    await drainWebsiteChecks(db, { organizationId: org, deps: { ...d } });
    const rows = await db.prospectWebsiteCheck.findMany({ where: { prospectId: { in: ps.map((p) => p.id) } } });
    expect(rows.every((r) => r.status === "DONE")).toBe(true);
    expect(rows.filter((r) => r.psiStatus === "OK").length).toBeLessThanOrEqual(5);
    expect(rows.filter((r) => r.psiStatus === "LIMIT").length).toBeGreaterThanOrEqual(2);
    expect(d.pageSpeed).toHaveBeenCalledTimes(rows.filter((r) => r.psiStatus === "OK").length);
  });
  it("only works on the organization it was asked to, and puts a stuck row back in the queue", async () => {
    const mine = await prospect(org), foreign = await prospect(other);
    await queueChecks(db, mgr, [mine.id], { now: NOW });
    await queueChecks(db, otherOrg, [foreign.id], { now: NOW });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: deps() });
    expect((await check(foreign.id)).status).toBe("QUEUED");
    await db.prospectWebsiteCheck.update({ where: { prospectId: foreign.id }, data: { status: "RUNNING", startedAt: new Date(NOW.getTime() - 30 * 60_000), attempts: 1 } });
    await runWebsiteChecks(db, { organizationId: org, now: NOW, deps: deps() });
    expect((await check(foreign.id)).status).toBe("QUEUED");
  });
  it("does not let two runners take the same row", async () => {
    const ps = await Promise.all(Array.from({ length: 4 }, () => prospect(other)));
    await queueChecks(db, otherOrg, ps.map((p) => p.id), { now: NOW });
    const d = deps();
    const [a, b] = await Promise.all([runWebsiteChecks(db, { organizationId: other, now: NOW, batch: 10, deps: d }), runWebsiteChecks(db, { organizationId: other, now: NOW, batch: 10, deps: d })]);
    expect(a.claimed + b.claimed).toBeGreaterThanOrEqual(4);
    expect(d.fetchPage).toHaveBeenCalledTimes(a.claimed + b.claimed);
    const rows = await db.prospectWebsiteCheck.findMany({ where: { prospectId: { in: ps.map((p) => p.id) } } });
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
  });
});
