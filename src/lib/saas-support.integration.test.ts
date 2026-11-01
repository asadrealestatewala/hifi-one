import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { EngagementError, setClientType, setProjectManager, setSupportManager, supportHandler } from "./engagements";
import { portalSupport } from "./portal";
import { createMeeting } from "./meetings";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, pm: string, support: string, inactive: string, outsider: string, saas: string, marketing: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Meeting","EmployeeProfile","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Sup Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const u = async (o: string, n: string, extra: object = {}) => (await db.user.create({ data: { organizationId: o, email: `${n}@s.test`, name: n, passwordHash: "x", ...extra } })).id;
  [pm, support, inactive] = [await u(org, "Pam PM"), await u(org, "Sue Support"), await u(org, "Gone", { active: false })];
  outsider = await u(other, "Outsider");
  await db.employeeProfile.create({ data: { organizationId: org, userId: support, employeeNo: "HFT-042" } });
  saas = (await db.client.create({ data: { organizationId: org, name: "SaaS Co", currency: "USD" } })).id;
  marketing = (await db.client.create({ data: { organizationId: org, name: "Mkt Co", currency: "USD" } })).id;
  await setClientType(db, { organizationId: org, clientId: saas, clientType: "SAAS" });
  await setProjectManager(db, { organizationId: org, clientId: saas, userId: pm });
  await setProjectManager(db, { organizationId: org, clientId: marketing, userId: pm });
});
afterAll(async () => { await db.$disconnect(); });

describe("SaaS support handling", () => {
  it("the project manager covers support until a support manager is set", async () => {
    let c = await db.client.findUniqueOrThrow({ where: { id: saas } });
    expect(supportHandler(c)).toBe(pm);
    const p = await portalSupport(db, saas);
    expect(p).toEqual({ name: "Pam PM", employeeNo: null, dedicated: false });
    await setSupportManager(db, { organizationId: org, clientId: saas, userId: support });
    c = await db.client.findUniqueOrThrow({ where: { id: saas } });
    expect(supportHandler(c)).toBe(support);
    expect(await portalSupport(db, saas)).toEqual({ name: "Sue Support", employeeNo: "HFT-042", dedicated: true });
    await setSupportManager(db, { organizationId: org, clientId: saas, userId: null });
    expect(supportHandler(await db.client.findUniqueOrThrow({ where: { id: saas } }))).toBe(pm);
  });
  it("refuses an inactive person, someone from another organization, and another organization's client", async () => {
    await expect(setSupportManager(db, { organizationId: org, clientId: saas, userId: inactive })).rejects.toThrow(EngagementError);
    await expect(setSupportManager(db, { organizationId: org, clientId: saas, userId: outsider })).rejects.toThrow(/active staff/);
    await expect(setSupportManager(db, { organizationId: other, clientId: saas, userId: outsider })).rejects.toThrow(/not found/);
    expect((await db.client.findUniqueOrThrow({ where: { id: saas } })).supportManagerId).toBeNull();
  });
  it("only SaaS customers get a support contact in their portal", async () => {
    await setSupportManager(db, { organizationId: org, clientId: marketing, userId: support });
    expect(await portalSupport(db, marketing)).toBeNull();
  });
  it("support, tutorial and inquiry meetings can be created for the client", async () => {
    for (const purpose of ["SUPPORT", "TUTORIAL", "INQUIRY"]) {
      const m = await createMeeting(db, { organizationId: org, hostId: support, title: `${purpose} call`, purpose, clientId: saas });
      expect(m.purpose).toBe(purpose);
      expect(m.clientId).toBe(saas);
    }
  });
});
