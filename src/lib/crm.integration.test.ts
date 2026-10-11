import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  CrmError, SYSTEM_LISTS, buildLeadWhere, campaignStats, cleanFilters, deleteSmartList, leadScore, logActivity, salesDashboard, saveCampaign, saveSmartList, setTarget, verifyActivity, visibleLists,
} from "./crm";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ann: string, bob: string, stageNew: string, stageInterested: string, stageWon: string;
const NOW = new Date("2026-10-11T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "SalesTarget","SmartList","Campaign","LeadActivity","Lead","PipelineStage","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "CRM Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  ann = (await db.user.create({ data: { organizationId: org, email: "a@crm.test", name: "Ann", passwordHash: "x" } })).id;
  bob = (await db.user.create({ data: { organizationId: org, email: "b@crm.test", name: "Bob", passwordHash: "x" } })).id;
  stageNew = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } })).id;
  stageInterested = (await db.pipelineStage.create({ data: { organizationId: org, name: "Interested", sortOrder: 2, probability: 25 } })).id;
  stageWon = (await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 3, probability: 100, isWon: true } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const mkLead = (over: Record<string, unknown> = {}) => db.lead.create({ data: { organizationId: org, name: "Lead", stageId: stageNew, assignedToId: ann, ...over } as never });

describe("lead score", () => {
  const stage = { probability: 25, isWon: false, isLost: false };
  it("rewards complete, recent, valuable leads and explains why", () => {
    const hot = leadScore({ email: "x@y.test", phone: "123456", company: "Co", serviceInterest: "SEO", dealValue: "5000", expectedCloseDate: "2026-10-25", lastContactAt: daysAgo(2), createdAt: daysAgo(30), stage }, NOW);
    expect(hot.score).toBeGreaterThanOrEqual(70);
    expect(hot.reasons.join(" ")).toContain("contacted in the last 7 days");
  });
  it("marks long silence down, and fixes won at 100 and lost at 0", () => {
    const cold = leadScore({ createdAt: daysAgo(60), stage: { probability: 10, isWon: false, isLost: false } }, NOW);
    expect(cold.score).toBeLessThan(10);
    expect(cold.reasons.join(" ")).toContain("no contact for");
    expect(leadScore({ createdAt: daysAgo(1), stage: { probability: 100, isWon: true, isLost: false } }, NOW).score).toBe(100);
    expect(leadScore({ createdAt: daysAgo(1), stage: { probability: 0, isWon: false, isLost: true } }, NOW).score).toBe(0);
  });
  it("always stays between 0 and 100", () => {
    const s = leadScore({ email: "a@b.c", phone: "1", company: "c", serviceInterest: "s", dealValue: "1", expectedCloseDate: "2026-10-12", lastContactAt: NOW, createdAt: NOW, stage: { probability: 100, isWon: false, isLost: false } }, NOW).score;
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("smart lists", () => {
  it("ignores unknown or malformed filter input", () => {
    expect(cleanFilters({ evil: "x", stageNames: ["New", 5], minValue: -3, noContactDays: 9999, priority: "URGENT", followUp: "never" })).toEqual({ stageNames: ["New"] });
    expect(cleanFilters(null)).toEqual({});
  });

  it("applies each filter inside the person's own scope", async () => {
    await mkLead({ name: "Quiet interested", stageId: stageInterested, lastContactAt: daysAgo(10), tags: ["vip"], dealValue: "20000", source: "LinkedIn" });
    await mkLead({ name: "Fresh", stageId: stageInterested, lastContactAt: daysAgo(1) });
    await mkLead({ name: "Bob's lead", assignedToId: bob, createdBy: undefined, createdById: bob });
    await mkLead({ name: "Due now", nextFollowUp: daysAgo(1) });
    await mkLead({ name: "Won already", stageId: stageWon });
    await mkLead({ name: "Nobody's", assignedToId: null, createdById: bob });
    const annScope = { organizationId: org, OR: [{ assignedToId: ann }, { createdById: ann }] };
    const names = async (f: Parameters<typeof buildLeadWhere>[0], scope: object = annScope) =>
      (await db.lead.findMany({ where: buildLeadWhere(f, { userId: ann, scope, now: NOW }) })).map((l) => l.name).sort();
    expect(await names({ stageNames: ["Interested"], noContactDays: 7, openOnly: true })).toEqual(["Quiet interested"]);
    expect(await names({ tag: "vip" })).toEqual(["Quiet interested"]);
    expect(await names({ minValue: 10000 })).toEqual(["Quiet interested"]);
    expect(await names({ source: "LinkedIn" })).toEqual(["Quiet interested"]);
    expect(await names({ followUp: "overdue", openOnly: true })).toEqual(["Due now"]);
    expect(await names({ openOnly: true })).not.toContain("Won already");
    expect(await names({ assignedTo: "me" })).not.toContain("Bob's lead"); // scope already hides Bob's lead from Ann
    expect(await names({ q: "fresh" })).toEqual(["Fresh"]);
    expect(await names({ q: "%" })).toEqual([]); // wildcards are literal
    // a manager scope sees everything, including unassigned
    expect(await names({ assignedTo: "unassigned" }, { organizationId: org })).toEqual(["Nobody's"]);
  });

  it("every built-in list is a valid filter set", () => {
    for (const l of SYSTEM_LISTS) expect(cleanFilters(l.filters), l.id).toEqual(l.filters);
  });

  it("saves private or shared lists; others see only shared; only the owner deletes", async () => {
    await expect(saveSmartList(db, { organizationId: org, ownerId: ann, name: " ", filters: { tag: "x" }, shared: false })).rejects.toThrow(CrmError);
    await expect(saveSmartList(db, { organizationId: org, ownerId: ann, name: "Empty", filters: {}, shared: false })).rejects.toThrow(/filter/);
    const mine = await saveSmartList(db, { organizationId: org, ownerId: ann, name: "My VIPs", filters: { tag: "vip", junk: 1 }, shared: false });
    const shared = await saveSmartList(db, { organizationId: org, ownerId: ann, name: "Team VIPs", filters: { tag: "vip" }, shared: true });
    await expect(saveSmartList(db, { organizationId: org, ownerId: ann, name: "My VIPs", filters: { tag: "x" }, shared: false })).rejects.toThrow(/already/);
    expect((await visibleLists(db, org, bob)).map((l) => l.name)).toEqual(["Team VIPs"]);
    expect((await visibleLists(db, org, ann)).map((l) => l.name)).toEqual(["My VIPs", "Team VIPs"]);
    expect((mine.filters as object)).toEqual({ tag: "vip" });
    await expect(deleteSmartList(db, { organizationId: org, ownerId: bob, id: shared.id })).rejects.toThrow(/not found/);
    await deleteSmartList(db, { organizationId: org, ownerId: ann, id: mine.id });
  });
});

describe("activities, verification and targets", () => {
  it("requires a call outcome and refuses outcomes on other kinds", async () => {
    const lead = await mkLead({ name: "Call target" });
    await expect(logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "CALL" })).rejects.toThrow(/how the call went/);
    await expect(logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "EMAIL", outcome: "CONNECTED" })).rejects.toThrow(/Only calls/);
    await expect(logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "DANCE" })).rejects.toThrow(CrmError);
    await expect(logActivity(db, { organizationId: other, leadId: lead.id, actorId: ann, kind: "NOTE" })).rejects.toThrow(/not found/);
  });

  it("only real contact updates last contact; a follow-up date can be set", async () => {
    const lead = await mkLead({ name: "Contact tracking" });
    await logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "CALL", outcome: "NO_ANSWER" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).lastContactAt).toBeNull();
    await logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "CALL", outcome: "CONNECTED", nextFollowUp: "2026-12-01" });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.lastContactAt).not.toBeNull();
    expect(after.nextFollowUp?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("a connected call counts toward targets only after someone else verifies it", async () => {
    const lead = await mkLead({ name: "Verify me" });
    const a = await logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "CALL", outcome: "CONNECTED" });
    await setTarget(db, { organizationId: org, userId: ann, metric: "CONNECTED_CALLS", daily: 80, monthly: 1600, actorId: bob });
    const read = async () => (await salesDashboard(db, { organizationId: org, userIds: [ann], now: new Date() }))[0];
    let r = await read();
    expect(r.today.CONNECTED_CALLS).toBe(0);
    expect(r.today.connectedPending).toBeGreaterThanOrEqual(1);
    expect(r.today.CALLS).toBeGreaterThanOrEqual(3);
    await expect(verifyActivity(db, { organizationId: org, activityId: a.id, verifierId: ann })).rejects.toThrow(/your own/);
    await verifyActivity(db, { organizationId: org, activityId: a.id, verifierId: bob });
    await expect(verifyActivity(db, { organizationId: org, activityId: a.id, verifierId: bob })).rejects.toThrow(/already/);
    r = await read();
    expect(r.today.CONNECTED_CALLS).toBe(1);
    expect(r.targets.CONNECTED_CALLS).toEqual({ daily: 80, monthly: 1600 });
  });

  it("only call outcomes of CONNECTED can be verified, and targets validate", async () => {
    const lead = await mkLead({ name: "Verify rules" });
    const miss = await logActivity(db, { organizationId: org, leadId: lead.id, actorId: ann, kind: "CALL", outcome: "NO_ANSWER" });
    await expect(verifyActivity(db, { organizationId: org, activityId: miss.id, verifierId: bob })).rejects.toThrow(/connected calls/);
    await expect(setTarget(db, { organizationId: org, userId: ann, metric: "VISITS", daily: 1, actorId: bob })).rejects.toThrow(CrmError);
    await expect(setTarget(db, { organizationId: org, userId: ann, metric: "CALLS", daily: -1, actorId: bob })).rejects.toThrow(/whole numbers/);
    await expect(setTarget(db, { organizationId: org, userId: "stranger", metric: "CALLS", daily: 5, actorId: bob })).rejects.toThrow(/staff member/);
    await setTarget(db, { organizationId: org, userId: ann, metric: "CALLS", daily: 5, actorId: bob });
    await setTarget(db, { organizationId: org, userId: ann, metric: "CALLS", daily: null, monthly: null, actorId: bob });
    expect(await db.salesTarget.count({ where: { userId: ann, metric: "CALLS" } })).toBe(0);
  });

  it("restricting the dashboard to some people hides everyone else", async () => {
    const rows = await salesDashboard(db, { organizationId: org, userIds: [bob] });
    expect(rows.map((r) => r.name)).toEqual(["Bob"]);
  });
});

describe("campaigns", () => {
  it("validates and reports leads, wins and cost per lead", async () => {
    await expect(saveCampaign(db, { organizationId: org, name: "", channel: "EMAIL", status: "ACTIVE", currency: "USD", actorId: ann })).rejects.toThrow(CrmError);
    await expect(saveCampaign(db, { organizationId: org, name: "X", channel: "TELEPATHY", status: "ACTIVE", currency: "USD", actorId: ann })).rejects.toThrow(CrmError);
    await expect(saveCampaign(db, { organizationId: org, name: "X", channel: "EMAIL", status: "ACTIVE", currency: "USD", startDate: "2026-05-01", endDate: "2026-04-01", actorId: ann })).rejects.toThrow(/end date/);
    const id = await saveCampaign(db, { organizationId: org, name: "Ramadan offer", channel: "FACEBOOK", status: "ACTIVE", budget: "1000", currency: "USD", actorId: ann });
    await expect(saveCampaign(db, { organizationId: org, name: "Ramadan offer", channel: "EMAIL", status: "ACTIVE", currency: "USD", actorId: ann })).rejects.toThrow(/already exists/);
    await mkLead({ name: "C1", campaignId: id });
    await mkLead({ name: "C2", campaignId: id });
    await mkLead({ name: "C3", campaignId: id, stageId: stageWon, dealValue: "700", currency: "USD" });
    const s = (await campaignStats(db, org)).find((x) => x.campaign.id === id)!;
    expect(s.leads).toBe(3);
    expect(s.won).toBe(1);
    expect(s.wonValue.toString()).toBe("700");
    expect(s.costPerLead?.toString()).toBe("333.33");
    expect(s.winRate).toBe(33);
    await expect(saveCampaign(db, { organizationId: other, id, name: "Hijack", channel: "EMAIL", status: "DONE", currency: "USD", actorId: ann })).rejects.toThrow(/not found/);
  });
});
