// Solution feed against hifi_one_test: signed reports, replay and tampering refused, newest report wins, linking, and that partners and
// sales agents see only the workspaces of their own clients.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addPartner, ensurePartnerDefaults } from "./partner-stack";
import { FeedError, cleanBaseUrl, connectSolution, createFeedKey, disconnectSolution, feedHealthAlerts, pullDue, pullSolution, type Fetcher, ingestReport, isStale, liveForAgent, liveForPartner, linkWorkspace, removeFeedKey, sign, signatureOk } from "./solution-feed";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const APP = "x".repeat(40);
const NOW = new Date("2026-11-17T06:00:00Z");
let org: string, other: string, officer: string, campusly: string, velocity: string, secret: string;
let schoolA: string, schoolB: string, dealer: string, imran: string, sara: string, agent: string, agent2: string;

const post = (body: unknown, over: { ts?: number; secret?: string; code?: string; now?: Date } = {}) => {
  const raw = JSON.stringify(body);
  const ts = String(over.ts ?? NOW.getTime());
  return ingestReport(db, { productCode: over.code ?? "CAMPUSLY", body: raw, timestamp: ts, signature: sign(over.secret ?? secret, ts, raw), now: over.now ?? NOW, appSecret: APP });
};
const report = (status = "LIVE", units = 420, reportedAt = NOW.toISOString()) => ({ reportedAt, workspaces: [
  { id: "beaconhouse-dha", name: "Beaconhouse DHA", status, plan: "Standard", paidUntil: "2026-12-05", activeUsers: 38, units, unitLabel: "students", lastActivityAt: "2026-11-17T05:40:00+05:00", appVersion: "2.3.1" },
  { id: "city-school", name: "City School", status: "TRIAL", units: 120, unitLabel: "students" },
] });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "SolutionConnection","SolutionWorkspace","SolutionFeedKey","ResaleSchool","Lead","PipelineStage","Client","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","Notification","UserRole","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat", email: "pat@hifi.test", passwordHash: "x" } })).id;
  agent = (await db.user.create({ data: { organizationId: org, name: "Ali", email: "ali@hifi.test", passwordHash: "x" } })).id;
  agent2 = (await db.user.create({ data: { organizationId: org, name: "Bilal", email: "bilal@hifi.test", passwordHash: "x" } })).id;
  await ensurePartnerDefaults(db, org);
  campusly = (await db.saasProduct.findFirstOrThrow({ where: { organizationId: org, code: "CAMPUSLY" } })).id;
  velocity = (await db.saasProduct.findFirstOrThrow({ where: { organizationId: org, code: "VELOCITY" } })).id;
  const base = { organizationId: org, actorId: officer, phone: "03001112223", city: "Lahore", country: "Pakistan", typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY"], trainingOptional: false };
  imran = (await addPartner(db, { ...base, name: "Muhammad Imran", email: "imran@schools.test" })).id;
  sara = (await addPartner(db, { ...base, name: "Sara Khan", email: "sara@schools.test" })).id;
  schoolA = (await db.client.create({ data: { organizationId: org, name: "Beaconhouse DHA", clientType: "SAAS" } })).id;
  schoolB = (await db.client.create({ data: { organizationId: org, name: "City School", clientType: "SAAS" } })).id;
  dealer = (await db.client.create({ data: { organizationId: org, name: "Lahore Motors", clientType: "SAAS" } })).id;
  await db.resaleSchool.create({ data: { organizationId: org, earnerId: imran, productId: campusly, clientId: schoolA, startMonth: "2026-11", addedById: officer } });
  await db.resaleSchool.create({ data: { organizationId: org, earnerId: sara, productId: campusly, clientId: schoolB, startMonth: "2026-11", addedById: officer } });
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 1, isWon: true } });
  await db.lead.create({ data: { organizationId: org, name: "Lahore Motors", stageId: stage.id, assignedToId: agent, clientId: dealer, convertedAt: NOW } });
  await db.lead.create({ data: { organizationId: org, name: "Beaconhouse DHA", stageId: stage.id, assignedToId: agent2, clientId: schoolA } }); // not converted
  secret = (await createFeedKey(db, { productId: campusly, userId: officer, appSecret: APP })).secret;
});
afterAll(async () => { await db.$disconnect(); });

describe("signatures", () => {
  it("accepts the right secret inside five minutes and refuses old, future, tampered or wrong ones", () => {
    const body = '{"a":1}', ts = String(NOW.getTime());
    const sig = sign("s3cret", ts, body);
    expect(signatureOk("s3cret", { timestamp: ts, body, signature: sig, now: NOW.getTime() })).toBe(true);
    expect(signatureOk("s3cret", { timestamp: ts, body, signature: `sha256=${sig}`, now: NOW.getTime() })).toBe(true);
    expect(signatureOk("s3cret", { timestamp: ts, body, signature: sig, now: NOW.getTime() + 6 * 60_000 })).toBe(false);
    expect(signatureOk("s3cret", { timestamp: ts, body, signature: sig, now: NOW.getTime() - 6 * 60_000 })).toBe(false);
    expect(signatureOk("s3cret", { timestamp: ts, body: '{"a":2}', signature: sig, now: NOW.getTime() })).toBe(false);
    expect(signatureOk("other", { timestamp: ts, body, signature: sig, now: NOW.getTime() })).toBe(false);
    expect(signatureOk("s3cret", { timestamp: "soon", body, signature: sig, now: NOW.getTime() })).toBe(false);
  });
  it("stores the secret sealed, never in clear", async () => {
    const k = await db.solutionFeedKey.findUniqueOrThrow({ where: { productId: campusly } });
    expect(k.secretEnc).not.toContain(secret);
    expect(k.hint).toBe(secret.slice(-4));
  });
});

describe("ingesting reports", () => {
  it("refuses a report signed with the wrong secret, for a Solution without a key, or in the wrong shape", async () => {
    await expect(post(report(), { secret: "sfk_wrong" })).rejects.toMatchObject({ status: 401 });
    await expect(post(report(), { code: "VELOCITY" })).rejects.toMatchObject({ status: 401 });
    await expect(post(report(), { ts: NOW.getTime() - 10 * 60_000 })).rejects.toBeInstanceOf(FeedError); // replayed later
    await expect(post({ workspaces: [{ id: "x", name: "X", status: "HAPPY" }] })).rejects.toMatchObject({ status: 400 });
    await expect(post({ workspaces: [] })).rejects.toMatchObject({ status: 400 });
    expect(await db.solutionWorkspace.count()).toBe(0);
  });
  it("stores counts only and drops any other field a Solution sends", async () => {
    const body = report();
    (body.workspaces[0] as Record<string, unknown>).students = [{ name: "Ayesha", fatherName: "Khan" }];
    const r = await post(body);
    expect(r).toEqual({ accepted: 2, created: 2, updated: 0, skipped: 0 });
    const w = await db.solutionWorkspace.findUniqueOrThrow({ where: { productId_externalId: { productId: campusly, externalId: "beaconhouse-dha" } } });
    expect(w).toMatchObject({ organizationId: org, status: "LIVE", units: 420, activeUsers: 38, planName: "Standard", paidUntil: "2026-12-05", clientId: null });
    expect(JSON.stringify(w)).not.toContain("Ayesha");
    expect((await db.solutionFeedKey.findUniqueOrThrow({ where: { productId: campusly } })).lastReportAt).toEqual(NOW);
  });
  it("updates with a newer report and ignores an older one arriving late", async () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(await post(report("OVERDUE", 430, later.toISOString()), { now: later, ts: later.getTime() })).toMatchObject({ updated: 2, created: 0 });
    expect(await post(report("LIVE", 400, NOW.toISOString()), { now: later, ts: later.getTime() })).toMatchObject({ skipped: 2 });
    const w = await db.solutionWorkspace.findUniqueOrThrow({ where: { productId_externalId: { productId: campusly, externalId: "beaconhouse-dha" } } });
    expect(w).toMatchObject({ status: "OVERDUE", units: 430 });
  });
});

describe("who sees what", () => {
  it("shows nothing to partners or agents until staff link the workspace", async () => {
    expect(await liveForPartner(db, org, imran, NOW)).toEqual([]);
    expect(await liveForAgent(db, org, agent, NOW)).toEqual([]);
  });
  it("links a workspace only to a client of the same organisation", async () => {
    const ws = await db.solutionWorkspace.findMany({ orderBy: { externalId: "asc" } });
    const dha = ws.find((w) => w.externalId === "beaconhouse-dha")!, city = ws.find((w) => w.externalId === "city-school")!;
    const foreign = (await db.client.create({ data: { organizationId: other, name: "Elsewhere School" } })).id;
    await expect(linkWorkspace(db, { organizationId: org, workspaceId: dha.id, clientId: foreign, actorId: officer })).rejects.toBeInstanceOf(FeedError);
    await expect(linkWorkspace(db, { organizationId: other, workspaceId: dha.id, clientId: foreign, actorId: officer })).rejects.toBeInstanceOf(FeedError);
    await linkWorkspace(db, { organizationId: org, workspaceId: dha.id, clientId: schoolA, actorId: officer, now: NOW });
    await linkWorkspace(db, { organizationId: org, workspaceId: city.id, clientId: schoolB, actorId: officer, now: NOW });
    expect((await db.solutionWorkspace.findUniqueOrThrow({ where: { id: dha.id } })).linkedById).toBe(officer);
  });
  it("gives each partner only their own schools", async () => {
    const mine = await liveForPartner(db, org, imran, NOW);
    expect(mine.map((r) => r.name)).toEqual(["Beaconhouse DHA"]);
    expect(mine[0]).toMatchObject({ product: "Campusly", status: "OVERDUE", units: 430, stale: false });
    expect((await liveForPartner(db, org, sara, NOW)).map((r) => r.name)).toEqual(["City School"]);
    expect(await liveForPartner(db, other, imran, NOW)).toEqual([]);
  });
  it("gives each sales agent only the clients they converted", async () => {
    const velSecret = (await createFeedKey(db, { productId: velocity, userId: officer, appSecret: APP })).secret;
    await post({ workspaces: [{ id: "lahore-motors", name: "Lahore Motors", status: "LIVE", activeUsers: 12, units: 3, unitLabel: "branches" }] }, { code: "VELOCITY", secret: velSecret });
    const motors = await db.solutionWorkspace.findFirstOrThrow({ where: { externalId: "lahore-motors" } });
    await linkWorkspace(db, { organizationId: org, workspaceId: motors.id, clientId: dealer, actorId: officer });
    expect((await liveForAgent(db, org, agent, NOW)).map((r) => r.name)).toEqual(["Lahore Motors"]);
    expect(await liveForAgent(db, org, agent2, NOW)).toEqual([]); // their lead was never converted
    expect(await liveForAgent(db, other, agent, NOW)).toEqual([]);
  });
  it("marks figures out of date after three hours without a report", async () => {
    const later = new Date(NOW.getTime() + 4 * 3_600_000);
    expect((await liveForPartner(db, org, imran, later))[0].stale).toBe(true);
    expect(isStale(NOW, new Date(NOW.getTime() + 3_600_000))).toBe(false);
  });
  it("refuses reports once the feed is switched off", async () => {
    expect(await removeFeedKey(db, campusly)).toBe(1);
    await expect(post(report())).rejects.toMatchObject({ status: 401 });
  });
  it("warns the partner team about a quiet feed and unlinked workspaces, once per day", async () => {
    await db.solutionWorkspace.create({ data: { organizationId: org, productId: velocity, externalId: "new-dealer", name: "New Dealer", status: "TRIAL", reportedAt: NOW } });
    const sent: string[] = [];
    const later = new Date(NOW.getTime() + 5 * 3_600_000);
    const r = await feedHealthAlerts(db, org, later, "2026-11-17", async (title, _b, key) => { sent.push(`${title}|${key}`); });
    expect(r).toBe("1 quiet, 1 unlinked"); // Velocity has gone quiet; Campusly was switched off and is not checked
    expect(sent).toEqual(["A Solution is not reporting|feed-quiet:" + org + ":2026-11-17", "1 Solution workspace to link|feed-unlinked:" + org + ":2026-11-17"]);
    expect(await feedHealthAlerts(db, other, later, "2026-11-17", async () => { throw new Error("no alerts for another organisation"); })).toBe("0 quiet, 0 unlinked");
  });
});

describe("reading a Solution with its API key", () => {
  const KEY = "pk_hifi_" + "a".repeat(40);
  const calls: { url: string; auth: string }[] = [];
  const pages: Record<string, unknown> = {
    "": { workspaces: [{ id: "roots-g9", name: "Roots G-9", status: "LIVE", units: 900, unitLabel: "students", activeUsers: 60 }], next: "p2" },
    p2: { workspaces: [{ id: "roots-f7", name: "Roots F-7", status: "TRIAL", units: 50, unitLabel: "students" }] },
  };
  const fake = (over: Partial<{ status: number; throws: boolean }> = {}): Fetcher => async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (over.throws) throw new Error("ECONNREFUSED");
    const status = over.status ?? (init.headers.authorization === `Bearer ${KEY}` ? 200 : 401);
    const cursor = new URL(url).searchParams.get("cursor") ?? "";
    return { ok: status === 200, status, json: async () => pages[cursor] };
  };
  let campus: string;
  beforeAll(async () => {
    campus = (await db.saasProduct.findFirstOrThrow({ where: { organizationId: org, code: "CAMPUSLY" } })).id;
  });

  it("cleans the address and refuses plain http, credentials and nonsense", () => {
    expect(cleanBaseUrl("campusly.co/console/anything")).toBe("https://campusly.co");
    expect(cleanBaseUrl(" https://app.campusly.co:8443/x ")).toBe("https://app.campusly.co:8443");
    expect(cleanBaseUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(() => cleanBaseUrl("http://campusly.co")).toThrow(FeedError);
    expect(() => cleanBaseUrl("https://me:pw@campusly.co")).toThrow(FeedError);
    expect(() => cleanBaseUrl("ftp://campusly.co")).toThrow(FeedError);
  });
  it("saves nothing when the key is wrong or the address cannot be reached", async () => {
    await expect(connectSolution(db, { productId: campus, baseUrl: "https://campusly.test", apiKey: "pk_wrong_" + "b".repeat(30), userId: officer, fetcher: fake(), appSecret: APP, now: NOW })).rejects.toThrow(/refused the API key/);
    await expect(connectSolution(db, { productId: campus, baseUrl: "https://campusly.test", apiKey: KEY, userId: officer, fetcher: fake({ throws: true }), appSecret: APP, now: NOW })).rejects.toThrow(/could not be reached/);
    await expect(connectSolution(db, { productId: campus, baseUrl: "https://campusly.test", apiKey: "short", userId: officer, fetcher: fake(), appSecret: APP })).rejects.toBeInstanceOf(FeedError);
    expect(await db.solutionConnection.count()).toBe(0);
  });
  it("connects, reads every page with the key and stores the key sealed", async () => {
    calls.length = 0;
    const r = await connectSolution(db, { productId: campus, baseUrl: "campusly.test", apiKey: KEY, userId: officer, fetcher: fake(), appSecret: APP, now: NOW });
    expect(r.result).toMatchObject({ accepted: 2, created: 2 });
    expect(calls.map((c) => c.url)).toEqual(["https://campusly.test/api/hifi-one/summary", "https://campusly.test/api/hifi-one/summary?cursor=p2"]);
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    const c = await db.solutionConnection.findUniqueOrThrow({ where: { productId: campus } });
    expect(c.apiKeyEnc).not.toContain(KEY);
    expect(c).toMatchObject({ hint: KEY.slice(-4), lastOkAt: NOW, lastError: null });
    expect(await db.solutionWorkspace.findFirst({ where: { externalId: "roots-g9" } })).toMatchObject({ organizationId: org, units: 900, status: "LIVE" });
  });
  it("keeps the working connection when a reconnect fails", async () => {
    await expect(connectSolution(db, { productId: campus, baseUrl: "https://elsewhere.test", apiKey: "pk_wrong_" + "c".repeat(30), userId: officer, fetcher: fake(), appSecret: APP, now: NOW })).rejects.toBeInstanceOf(FeedError);
    expect((await db.solutionConnection.findUniqueOrThrow({ where: { productId: campus } })).baseUrl).toBe("https://campusly.test");
  });
  it("reads again only after 15 minutes and records a failure without throwing", async () => {
    calls.length = 0;
    expect(await pullDue(db, { fetcher: fake(), appSecret: APP, now: new Date(NOW.getTime() + 5 * 60_000) })).toEqual({ ok: 0, failed: 0 });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(await pullDue(db, { fetcher: fake({ status: 500 }), appSecret: APP, now: later })).toEqual({ ok: 0, failed: 1 });
    const c = await db.solutionConnection.findUniqueOrThrow({ where: { productId: campus } });
    expect(c.lastError).toMatch(/error \(500\)/);
    expect(c.lastOkAt).toEqual(NOW);
    await expect(pullSolution(db, campus, { fetcher: fake(), appSecret: APP, now: later })).resolves.toMatchObject({ updated: 2 });
    expect((await db.solutionConnection.findUniqueOrThrow({ where: { productId: campus } })).lastError).toBeNull();
  });
  it("stops reading once disconnected", async () => {
    expect(await disconnectSolution(db, campus)).toBe(1);
    await expect(pullSolution(db, campus, { fetcher: fake(), appSecret: APP })).rejects.toMatchObject({ status: 404 });
  });
});
