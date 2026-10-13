import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadAttention, loadHero, periodRange } from "./dashboard-home";
import { loadLeadsReport } from "./leads-report";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, bob: string, sNew: string, sWon: string, sLost: string;
const range = { from: "2026-10-01", to: "2026-10-31" };
const at = (d: string) => new Date(`${d}T10:00:00Z`);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContactActivity","Contact","LeadActivity","Lead","PipelineStage","Client","Payment","BankAccount","ExpenseVoucher","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Dash Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@d.test"); bob = await mk("bob@d.test");
  const st = (name: string, sortOrder: number, extra = {}) => db.pipelineStage.create({ data: { organizationId: org, name, sortOrder, probability: 10, ...extra } }).then((s) => s.id);
  sNew = await st("New", 1); sWon = await st("Closed Won", 9, { isWon: true }); sLost = await st("Closed Lost", 10, { isLost: true });
  const lead = (name: string, extra: Record<string, unknown>) => db.lead.create({ data: { organizationId: org, name, stageId: sNew, ...extra } });
  await lead("A", { source: "Facebook", assignedToId: ann, createdAt: at("2026-10-02"), dealValue: "1000", currency: "USD", nextFollowUp: at("2026-10-05") });
  await lead("B", { source: "Facebook", assignedToId: ann, createdAt: at("2026-10-09"), stageId: sWon, convertedAt: at("2026-10-12"), dealValue: "500", currency: "USD" });
  await lead("C", { source: "Referral", assignedToId: bob, createdAt: at("2026-10-15"), stageId: sLost, stageChangedAt: at("2026-10-20") });
  await lead("D", { assignedToId: bob, createdAt: at("2026-09-10"), dealValue: "200", currency: "PKR" });
});
afterAll(async () => { await db.$disconnect(); });

describe("period ranges", () => {
  it("covers the month, last month, quarter and year around the company's today", () => {
    expect(periodRange("month", "2026-10-13")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("last", "2026-01-13")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("quarter", "2026-11-30")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("year", "2026-03-01")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("leads report", () => {
  it("counts new, won, lost and open leads, the conversion rate, sources, owners and per-currency pipeline", async () => {
    const r = await loadLeadsReport(db, org, { organizationId: org }, range);
    expect(r).toMatchObject({ total: 4, created: 3, won: 1, lost: 1, open: 2, conversion: 50 });
    expect(r.pipeline).toEqual(expect.arrayContaining([{ currency: "USD", value: "1000.00", count: 1 }, { currency: "PKR", value: "200.00", count: 1 }]));
    expect(r.bySource.find((s) => s.source === "Facebook")).toEqual({ source: "Facebook", leads: 2, won: 1 });
    expect(r.byOwner.find((o) => o.id === ann)).toMatchObject({ leads: 2, won: 1 });
    expect(r.funnel.map((f) => [f.name, f.count])).toEqual([["New", 2], ["Closed Won", 1], ["Closed Lost", 1]]);
    expect(r.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it("only sees the leads the caller's rule allows", async () => {
    const mine = await loadLeadsReport(db, org, { organizationId: org, assignedToId: bob }, range);
    expect(mine).toMatchObject({ total: 2, created: 1, won: 0 });
    expect(await loadLeadsReport(db, "other", { organizationId: "other" }, range)).toMatchObject({ total: 0, conversion: null });
  });
});

describe("hero numbers and what needs attention", () => {
  it("counts new leads in the period and nothing financial without finance access", async () => {
    const h = await loadHero(db, org, range, new Date("2026-10-13T00:00:00Z"), false, { organizationId: org });
    expect(h.leads).toEqual({ fresh: 3, total: 4 });
    expect(h.collected).toEqual([]);
    expect(h.overdue.count).toBe(0);
  });

  it("shows each person only the sections their role allows", async () => {
    const today = "2026-10-13", now = new Date("2026-10-13T08:00:00Z");
    const none = await loadAttention(db, org, { id: ann, permissions: new Set() }, today, now, null);
    expect([none.followups, none.overdue, none.vouchers, none.commissions, none.attendance, none.posts, none.leave]).toEqual([null, null, null, null, null, null, null]);
    const sales = await loadAttention(db, org, { id: ann, permissions: new Set(["crm.view"]) }, today, now, { organizationId: org, assignedToId: ann });
    expect(sales.followups).toMatchObject({ count: 1, rows: [expect.objectContaining({ name: "A", due: "2026-10-05" })] });
    expect(sales.urgent).toBe(1); // the follow-up from 5 Oct is past due
    const hr = await loadAttention(db, org, { id: ann, permissions: new Set(["attendance.view_all", "leave.approve"]) }, today, now, null);
    expect(hr.attendance?.count).toBe(2); // nobody has marked attendance today
  });
});
