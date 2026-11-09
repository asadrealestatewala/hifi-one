import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { approveConversion, rejectConversion, requestConversion } from "./conversion-requests";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, agent: string, boss: string, other: string, won: string, role: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeadConversionRequest","Notification","LeadActivity","Lead","PipelineStage","Client","NumberSequence","Invoice","InvoiceLine","UserRole","RolePermission","Role","Permission","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Won Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e.split("@")[0], passwordHash: "x" } }).then((u) => u.id);
  agent = await mk("agent@w.test"); boss = await mk("boss@w.test"); other = await mk("plain@w.test");
  const perm = await db.permission.create({ data: { key: "crm.convert", description: "x" } });
  role = (await db.role.create({ data: { organizationId: org, key: "SALES_MANAGER", name: "Sales Manager", permissions: { create: [{ permissionId: perm.id }] } } })).id;
  await db.userRole.create({ data: { userId: boss, roleId: role } });
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  won = (await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 9, probability: 100, isWon: true } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const lead = async (name: string) => {
  const s = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, isWon: false } });
  return db.lead.create({ data: { organizationId: org, name, stageId: s.id, assignedToId: agent, currency: "USD" } });
};
const ask = (leadId: string, note?: string) => requestConversion(db, { organizationId: org, leadId, requesterId: agent, requesterName: "agent", wonStageId: won, note });

describe("Closed Won approval requests", () => {
  it("notifies only people with crm.convert, keeps the lead in its stage, and does not duplicate an open request", async () => {
    const l = await lead("Alpha");
    const r = await ask(l.id, "client paid advance");
    expect(r.alreadyPending).toBe(false);
    expect(await db.notification.count({ where: { userId: boss, kind: "LEAD_WON_APPROVAL" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: other } })).toBe(0);
    expect(await db.notification.count({ where: { userId: agent } })).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.id } })).clientId).toBeNull();
    const again = await ask(l.id);
    expect(again).toEqual({ id: r.id, alreadyPending: true });
    expect(await db.leadConversionRequest.count({ where: { leadId: l.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: boss, kind: "LEAD_WON_APPROVAL" } })).toBe(1);
  });

  it("approving converts the lead once and tells the agent", async () => {
    const l = await lead("Beta");
    const r = await ask(l.id);
    const a = await approveConversion(db, { organizationId: org, requestId: r.id, actorId: boss });
    expect(a.ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.id } })).clientId).not.toBeNull();
    expect((await db.leadConversionRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");
    expect(await db.notification.count({ where: { userId: agent, kind: "LEAD_WON_DECISION", title: { contains: "approved" } } })).toBeGreaterThan(0);
    expect(await approveConversion(db, { organizationId: org, requestId: r.id, actorId: boss })).toMatchObject({ ok: false });
    await expect(ask(l.id)).rejects.toThrow(/already converted/);
  });

  it("rejecting needs a reason, leaves the lead unconverted, notifies the agent, and allows a new request later", async () => {
    const l = await lead("Gamma");
    const r = await ask(l.id);
    expect(await rejectConversion(db, { organizationId: org, requestId: r.id, actorId: boss, reason: " " })).toMatchObject({ ok: false });
    expect(await rejectConversion(db, { organizationId: org, requestId: r.id, actorId: boss, reason: "No payment yet" })).toEqual({ ok: true });
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.id } })).clientId).toBeNull();
    expect(await db.notification.count({ where: { userId: agent, body: "No payment yet" } })).toBe(1);
    expect(await rejectConversion(db, { organizationId: org, requestId: r.id, actorId: boss, reason: "again" })).toMatchObject({ ok: false });
    expect((await ask(l.id)).alreadyPending).toBe(false);
  });

  it("does not touch another organization's request", async () => {
    const l = await lead("Delta");
    const r = await ask(l.id);
    const o2 = (await db.organization.create({ data: { name: "Else" } })).id;
    expect(await approveConversion(db, { organizationId: o2, requestId: r.id, actorId: boss })).toMatchObject({ ok: false });
    expect(await rejectConversion(db, { organizationId: o2, requestId: r.id, actorId: boss, reason: "nope nope" })).toMatchObject({ ok: false });
  });
});
