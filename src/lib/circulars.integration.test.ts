import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CircularError, acknowledgeCircular, circularReport, myCirculars, openCirculars, sendCircular } from "./circulars";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, hr: string, a: string, b: string, gone: string, outsider: string, client: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CircularRecipient","Circular","Notification","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Circ Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const sales = await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales Agent" } });
  const mk = (email: string, extra: object = {}) => db.user.create({ data: { organizationId: org, email, name: email.split("@")[0], passwordHash: "x", ...extra } });
  hr = (await mk("hr@c.test")).id;
  a = (await mk("amna@c.test", { roles: { create: { roleId: sales.id } } })).id;
  b = (await mk("bilal@c.test")).id;
  gone = (await mk("gone@c.test", { active: false })).id;
  client = (await mk("client@c.test", { userType: "CLIENT" })).id;
  outsider = (await db.user.create({ data: { organizationId: other, email: "out@c.test", name: "Out", passwordHash: "x" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const base = { kind: "WORK_FROM_HOME", title: "WFH Friday", body: "Work from home this Friday." };

describe("HR circulars", () => {
  it("goes to every active employee, not clients, inactive or other organisations, and notifies each", async () => {
    const r = await sendCircular(db, { organizationId: org, sentById: hr, ...base, audience: { type: "ALL" } });
    expect(r.recipients).toBe(3);
    const rows = await db.circularRecipient.findMany({ where: { circularId: r.id } });
    expect(rows.map((x) => x.userId).sort()).toEqual([hr, a, b].sort());
    for (const u of [a, b]) expect(await db.notification.count({ where: { userId: u, kind: "circular" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: client } })).toBe(0);
  });

  it("can target a role or chosen people, and drops people outside the organisation", async () => {
    const byRole = await sendCircular(db, { organizationId: org, sentById: hr, ...base, title: "Sales only", audience: { type: "ROLES", roleKeys: ["SALES_AGENT"] } });
    expect((await db.circularRecipient.findMany({ where: { circularId: byRole.id } })).map((x) => x.userId)).toEqual([a]);
    const chosen = await sendCircular(db, { organizationId: org, sentById: hr, ...base, title: "Two", audience: { type: "PEOPLE", userIds: [b, outsider, gone] } });
    expect(chosen.recipients).toBe(1);
    await expect(sendCircular(db, { organizationId: org, sentById: hr, ...base, audience: { type: "PEOPLE", userIds: [outsider] } })).rejects.toBeInstanceOf(CircularError);
  });

  it("rejects empty text and empty audiences", async () => {
    await expect(sendCircular(db, { organizationId: org, sentById: hr, ...base, title: " ", audience: { type: "ALL" } })).rejects.toThrow("title");
    await expect(sendCircular(db, { organizationId: org, sentById: hr, ...base, audience: { type: "ROLES", roleKeys: [] } })).rejects.toThrow("role");
  });

  it("keeps showing as open until the person confirms; only they can confirm; the bell item is marked read; HR sees who has read it", async () => {
    const r = await sendCircular(db, { organizationId: org, sentById: hr, ...base, title: "Pop up", audience: { type: "PEOPLE", userIds: [a, b] } });
    expect((await openCirculars(db, a)).map((c) => c.id)).toContain(r.id);
    expect(await acknowledgeCircular(db, outsider, r.id)).toBe(false);
    expect((await openCirculars(db, a)).map((c) => c.id)).toContain(r.id);
    expect(await acknowledgeCircular(db, a, r.id)).toBe(true);
    expect(await acknowledgeCircular(db, a, r.id)).toBe(false);
    expect((await openCirculars(db, a)).map((c) => c.id)).not.toContain(r.id);
    expect((await myCirculars(db, a)).find((c) => c.id === r.id)?.acknowledged).toBe(true);
    expect((await db.notification.findFirst({ where: { userId: a, dedupeKey: `circular:${r.id}` } }))?.readAt).not.toBeNull();
    expect((await db.notification.findFirst({ where: { userId: b, dedupeKey: `circular:${r.id}` } }))?.readAt).toBeNull();
    const rep = await circularReport(db, org, r.id);
    expect(rep?.acknowledged).toBe(1);
    expect(rep?.recipients[0].name).toBe("bilal"); // not-yet-read first
    expect(await circularReport(db, other, r.id)).toBeNull();
  });
});
