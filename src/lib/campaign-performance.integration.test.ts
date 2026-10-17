import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { SpendError, addSpend, deleteSpend, performance } from "./campaign-performance";
import { reportPdf } from "./pdf";
import { companyFrom } from "./pdf-data";
import { DEFAULT_DOC_CONFIG } from "./pdf";
import { buildReport, reportCsv } from "./report-tables";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, camp: string, staff: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CampaignSpend","Deliverable","Task","Project","LeadActivity","Lead","PipelineStage","Client","Campaign","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Perf Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  staff = (await db.user.create({ data: { organizationId: org, email: "s@p.test", name: "Sam", passwordHash: "x" } })).id;
  camp = (await db.campaign.create({ data: { organizationId: org, name: "Podvet", code: "CMP-0003", description: "A vet clinic management system." } })).id;
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  const won = await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 9, isWon: true } });
  const mk = (name: string, over: Record<string, unknown> = {}) => db.lead.create({ data: { organizationId: org, name, stageId: stage.id, campaignId: camp, createdAt: new Date("2026-10-05T10:00:00Z"), ...over } });
  await mk("L1"); await mk("L2"); await mk("L3");
  await mk("L4", { stageId: won.id, dealValue: "900", currency: "USD" });
  await mk("Old", { createdAt: new Date("2026-08-01T10:00:00Z") });
  await db.project.create({ data: { organizationId: org, number: "P1", name: "Podvet site", managerId: staff, campaignId: camp } });
});
afterAll(async () => { await db.$disconnect(); });

const add = (over: Partial<Parameters<typeof addSpend>[1]> = {}) => addSpend(db, { organizationId: org, campaignId: camp, actorId: staff, date: "2026-10-06", platform: "Meta", amount: "300", currency: "USD", today: "2026-10-17", ...over });

describe("campaign spend", () => {
  it("rejects bad entries and other organizations' campaigns", async () => {
    await expect(add({ amount: "-5" })).rejects.toThrow(SpendError);
    await expect(add({ amount: "12abc" })).rejects.toThrow(/positive number/);
    await expect(add({ date: "2026-12-01" })).rejects.toThrow(/future/);
    await expect(add({ date: "yesterday" })).rejects.toThrow(/date/);
    await expect(add({ platform: "" })).rejects.toThrow(/where/);
    await expect(add({ currency: "EUR" })).rejects.toThrow(/currency/);
    await expect(add({ impressions: "100", clicks: "400" })).rejects.toThrow(/more than impressions/);
    await expect(addSpend(db, { organizationId: other, campaignId: camp, actorId: staff, date: "2026-10-06", platform: "Meta", amount: "1", currency: "USD" })).rejects.toThrow(/not found/);
  });

  it("works out cost per lead, win and return per currency without mixing them", async () => {
    await add({ amount: "300", impressions: "10000", clicks: "250", results: "12" });
    await add({ date: "2026-10-09", platform: "Google", amount: "150.50", impressions: "5000", clicks: "100" });
    await add({ date: "2026-10-10", platform: "Print", amount: "40000", currency: "PKR" });
    const perf = await performance(db, org, camp, { from: "2026-10-01", to: "2026-10-31" });
    expect(perf.spend).toEqual(expect.arrayContaining([{ currency: "USD", amount: 450.5 }, { currency: "PKR", amount: 40000 }]));
    expect(perf.leads).toBe(4);
    expect(perf.won).toBe(1);
    expect(perf.conversion).toBe(25);
    expect(perf.costPerLead.find((c) => c.currency === "USD")?.amount).toBe(112.63);
    expect(perf.costPerWon.find((c) => c.currency === "USD")?.amount).toBe(450.5);
    expect(perf.wonValue).toEqual([{ currency: "USD", amount: 900 }]);
    expect(perf.roi).toEqual([{ currency: "USD", percent: 100 }]);
    expect(perf).toMatchObject({ impressions: 15000, clicks: 350, results: 12, ctr: 2.33 });
    expect(perf.byPlatform[0]).toMatchObject({ platform: "Print", currency: "PKR" });
  });

  it("limits figures to the chosen dates, including leads created outside them", async () => {
    const all = await performance(db, org, camp);
    expect(all.leads).toBe(5);
    const sept = await performance(db, org, camp, { from: "2026-09-01", to: "2026-09-30" });
    expect(sept).toMatchObject({ leads: 0, spend: [], costPerLead: [], roi: [] });
    const aug = await performance(db, org, camp, { from: "2026-08-01", to: "2026-08-31" });
    expect(aug.leads).toBe(1);
  });

  it("builds an internal report with spend and a client report without any", async () => {
    const internal = await buildReport(db, "campaign", { organizationId: org, campaignId: camp, from: "2026-10-01", to: "2026-10-31" });
    const client = await buildReport(db, "campaign_client", { organizationId: org, campaignId: camp, from: "2026-10-01", to: "2026-10-31" });
    expect(internal.title).toBe("Campaign performance: Podvet");
    expect(reportCsv(internal)).toContain("Spend entered");
    const clientCsv = reportCsv(client);
    expect(clientCsv).toContain("Leads generated");
    for (const word of ["Spend", "spend", "Cost per", "Return on", "Meta", "Google", "40000", "450.5"]) expect(clientCsv).not.toContain(word);
    expect(reportCsv(await buildReport(db, "campaign", { organizationId: other, campaignId: camp, from: "2026-10-01", to: "2026-10-31" }))).toContain("Campaign not found");
    const pdf = await reportPdf({ ...client, company: companyFrom({ legalName: "Perf Org" }), config: DEFAULT_DOC_CONFIG, generatedBy: "Tester" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("deletes an entry only inside the organization", async () => {
    const e = await db.campaignSpend.findFirstOrThrow({ where: { campaignId: camp, platform: "Print" } });
    await expect(deleteSpend(db, { organizationId: other, id: e.id })).rejects.toThrow(/not found/);
    await deleteSpend(db, { organizationId: org, id: e.id });
    expect((await performance(db, org, camp)).spend.find((s) => s.currency === "PKR")).toBeUndefined();
  });
});
