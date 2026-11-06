import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addProspect } from "./prospect-manual";
import { importProspects, planImport, type ImportInput, type SheetInput } from "./prospect-import";
import { detectSheet } from "./prospect-import";
import { prospectWhere, ProspectorError, type Actor } from "./prospector";
import { addSuppression } from "./worklists";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ali: Actor, mgr: Actor, agent: Actor, viewer: Actor, foreign: Actor;
const NOW = new Date("2026-11-06T10:00:00Z");
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });

const HEAD = ["Sr. No.", "Name of Business", "Contact", "Website Link", "Google Map Link", "Status", "Remarks"];
const sheet = (name: string, rows: string[][]): SheetInput => ({ name, rows, ...detectSheet(rows) });
const row = (n: string, name: string, phone: string, site = "", maps = "", status = "", remarks = "") => [n, name, phone, site, maps, status, remarks];
const input = (sheets: SheetInput[], over: Partial<ImportInput> = {}): ImportInput => ({ sheets, country: "PK", ...over });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectOutreach","ProspectSocial","ProspectWebsiteCheck","Prospect","ProspectSearch","SuppressedContact","LeadKey","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","CrmSettings","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Import Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [a, m, g, v, o] = await Promise.all([mk(org, "a@i.test", "Ali"), mk(org, "m@i.test", "Mona Manager"), mk(org, "g@i.test", "Gul Agent"), mk(org, "v@i.test", "Vic"), mk(other, "o@i.test", "Olga")]);
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  ali = actor(a, org, ["crm.view", "crm.edit"]);
  mgr = actor(m, org, ["crm.view", "crm.edit", "crm.view_all"]);
  agent = actor(g, org, ["crm.view", "crm.edit"]);
  viewer = actor(v, org, ["crm.view"]);
  foreign = actor(o, other, ["crm.view", "crm.edit", "crm.view_all"]);
  // an agent role is what assignableAgents looks up: give Gul crm.edit through a role
  const role = await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales agent" } });
  const perm = await db.permission.upsert({ where: { key: "crm.edit" }, update: {}, create: { key: "crm.edit", description: "Edit CRM" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  await db.userRole.create({ data: { userId: g, roleId: role.id } });
  // an existing CRM lead and a do-not-contact number
  await db.lead.create({ data: { organizationId: org, name: "Old Lead", phone: "+923005550003", stageId: stage.id } });
  await addSuppression(db, { organizationId: org, phone: "+923005550004", reason: "asked" });
});
afterAll(async () => { await db.$disconnect(); });

describe("importing prospects from a hand-made sheet", () => {
  it("only a sales manager can import", async () => {
    const s = sheet("T", [HEAD, row("1", "A", "0300 5550001")]);
    await expect(importProspects(db, ali, input([s]), NOW)).rejects.toThrow(/sales manager/);
    await expect(planImport(db, viewer, input([s]))).rejects.toThrow(/sales manager/);
    await expect(planImport(db, foreign, input([s]))).resolves.toBeTruthy(); // their own organization, nothing of ours
  });

  it("needs a name column and at least one sheet", async () => {
    await expect(planImport(db, mgr, input([{ name: "T", rows: [["Phone"], ["0300"]], headerRow: 0, map: { phone: 0 } }]))).rejects.toThrow(/business name/);
    await expect(planImport(db, mgr, input([{ ...sheet("T", [HEAD, row("1", "A", "0300 5550001")]), include: false }]))).rejects.toThrow(/at least one sheet/);
  });

  it("previews without saving anything", async () => {
    const s = sheet("T", [HEAD, row("1", "Preview Co", "3005550010", "Dont have website", "https://maps.app.goo.gl/p")]);
    const plan = await planImport(db, mgr, input([s]));
    expect(plan.counts.ready).toBe(1);
    expect(plan.rows[0]).toMatchObject({ phone: "+923005550010", website: null, mapsUrl: "https://maps.app.goo.gl/p" });
    expect(await db.prospect.count({ where: { name: "Preview Co" } })).toBe(0);
  });

  it("imports a messy two-tab sheet: phones, links, notes, a date line, labels, and checks every row", async () => {
    await addProspect(db, ali, { name: "Already Mine", phone: "0300 5550002", country: "PK", source: "REFERRAL" }, NOW);
    const t1 = sheet("Shagufta", [
      HEAD,
      ["            5 Nov     11/5/2026"],
      row("1", "Divine Marketing", "3359275375", "Dont have website", "https://maps.app.goo.gl/d1", "Interested on whatsapp", "Connected on whatsapp"),
      row("2", "Nuvo Real Estate", "3355102905", "http://bahriatownnuvo.com/", "https://maps.app.goo.gl/d2", "Currently Unavailable", ""),
      row("3", "Waraich Real Estate", "3335258287", "", "https://maps.app.goo.gl/d3", "Not interested", "He wants to close his business"),
      row("4", "Mohsin Real Estate", "  0339-1377777", "https://mohsinrealestate.xyz/", "", "Warm Lead ", ""),
      row("5", "Divine Again", "0335 9275375", "", "", "", "same number as row 1"),
      row("6", "Existing Prospect Co", "0300 5550002"),
      row("7", "Lead Co", "03005550003"),
      row("8", "Blocked Co", "0300 5550004"),
      row("9", "No Number Co", "Dont have whatsapp"),
      row("10", "", "0300 5550099"),
      row("11", "Facebook Only", "3045550011", "https://www.facebook.com/khanzadapropertyexchange"),
    ]);
    const t2 = sheet("Faryal", [
      ["Sr. No.", "Name of Business", "Contact no.", "Website Link", "", "Remarks"],
      ["1", "Az property", "3360015007", " Dont have a website    https://maps.app.goo.gl/Uo", "", ""],
      ["2", "AL Harman", "            03183003332                 https://maps.app.goo.gl/mR7r", "", "", ""],
      ["3", "Divine Marketing Faisal Town", "3359275375", "", "https://maps.app.goo.gl/dup", ""],
    ]);
    const r = await importProspects(db, mgr, input([t1, t2], { label: "Manual scrape", closeNotInterested: true }), NOW);

    expect(r.imported).toBe(7);
    expect(r.closed).toBe(1);
    const kinds = Object.fromEntries(["invalid", "inFile", "prospect", "lead", "suppressed"].map((k) => [k, r.skipped.filter((s) => s.kind === k).length]));
    expect(kinds).toEqual({ invalid: 2, inFile: 2, prospect: 1, lead: 1, suppressed: 1 });
    expect(r.skipped.find((s) => s.name === "Blocked Co")?.reason).toMatch(/do-not-contact/);
    expect(r.skipped.find((s) => s.name === "Lead Co")?.reason).toMatch(/CRM lead/);
    expect(r.skipped.find((s) => s.name === "Divine Again")?.reason).toMatch(/Shagufta row 3/);
    expect(r.skipped.find((s) => s.name === "No Number Co")?.reason).toMatch(/does not look like a valid number|No phone/);

    const all = await db.prospect.findMany({ where: { sourceLabel: "Manual scrape" }, orderBy: { name: "asc" } });
    expect(all).toHaveLength(7);
    const by = (n: string) => all.find((p) => p.name === n)!;
    expect(by("Divine Marketing")).toMatchObject({ phone: "+923359275375", website: null, mapsUrl: "https://maps.app.goo.gl/d1", origin: "MANUAL", sourceDetail: "Shagufta", status: "NEW", assignedToId: null, addedById: mgr.id, country: "PK", placeId: expect.stringMatching(/^import:/) });
    expect(by("Divine Marketing").notes).toBe("Status in the sheet: Interested on whatsapp. Connected on whatsapp.");
    expect(by("Nuvo Real Estate").website).toBe("http://bahriatownnuvo.com");
    expect(by("Mohsin Real Estate").phone).toBe("+923391377777");
    expect(by("Waraich Real Estate")).toMatchObject({ status: "NOT_INTERESTED", assignedToId: null });
    expect(by("AL Harman")).toMatchObject({ phone: "+923183003332", mapsUrl: "https://maps.app.goo.gl/mR7r" });
    expect(by("Az property")).toMatchObject({ phone: "+923360015007", website: null, mapsUrl: "https://maps.app.goo.gl/Uo", sourceDetail: "Faryal" });
    expect((await db.prospectSocial.findUniqueOrThrow({ where: { prospectId: by("Facebook Only").id } })).facebookUrl).toBe("https://www.facebook.com/khanzadapropertyexchange");
    expect(all.every((p) => p.score !== null)).toBe(true);
    expect(await db.lead.count()).toBe(1); // still only the existing lead: imports are prospects
  });

  it("a second import of the same file adds nothing and says why", async () => {
    const s = sheet("T", [HEAD, row("1", "Divine Marketing", "3359275375"), row("2", "Nuvo", "3355102905")]);
    const plan = await planImport(db, mgr, input([s]));
    expect(plan.counts.ready).toBe(0);
    expect(plan.counts.prospect).toBe(2);
    await expect(importProspects(db, mgr, input([s]), NOW)).rejects.toThrow(/Nothing to import/);
  });

  it("two imports at the same moment still save each business once", async () => {
    const s = sheet("T", [HEAD, row("1", "Race Co", "3005550020"), row("2", "Race Two", "3005550021")]);
    const [a, b] = await Promise.allSettled([importProspects(db, mgr, input([s]), NOW), importProspects(db, mgr, input([s]), NOW)]);
    const ok = [a, b].filter((x) => x.status === "fulfilled").length;
    expect(ok).toBeGreaterThanOrEqual(1);
    expect(await db.prospect.count({ where: { name: { in: ["Race Co", "Race Two"] } } })).toBe(2);
  });

  it("can assign the whole file to an agent, who sees it in their list and is told", async () => {
    const s = sheet("T", [HEAD, row("1", "Assigned Co", "3005550030"), row("2", "Closed Co", "3005550031", "", "", "Not interested")]);
    const r = await importProspects(db, mgr, input([s], { assignToId: agent.id }), NOW);
    expect(r).toMatchObject({ imported: 2, assigned: 1, closed: 1 });
    const mine = await db.prospect.findMany({ where: prospectWhere(agent, { mineOnly: true }) });
    expect(mine.map((p) => p.name)).toEqual(["Assigned Co"]);
    expect(mine[0]).toMatchObject({ status: "ASSIGNED", assignedToId: agent.id });
    expect(await db.notification.count({ where: { userId: agent.id } })).toBe(1);
    await expect(importProspects(db, mgr, input([sheet("T", [HEAD, row("1", "X Co", "3005550040")])], { assignToId: "nobody" }), NOW)).rejects.toThrow(ProspectorError);
  });

  it("keeps a Not interested row open when asked to", async () => {
    const s = sheet("T", [HEAD, row("1", "Still Open", "3005550050", "", "", "Not interested")]);
    await importProspects(db, mgr, input([s], { closeNotInterested: false }), NOW);
    expect((await db.prospect.findFirstOrThrow({ where: { name: "Still Open" } })).status).toBe("NEW");
  });

  it("reads a local number in the chosen country", async () => {
    const s = sheet("T", [HEAD, row("1", "Dubai Co", "050 123 4567")]);
    await importProspects(db, mgr, input([s], { country: "AE" }), NOW);
    expect(await db.prospect.findFirstOrThrow({ where: { name: "Dubai Co" } })).toMatchObject({ phone: "+971501234567", country: "AE" });
  });

  it("does not touch another organization", async () => {
    const s = sheet("T", [HEAD, row("1", "Divine Marketing", "3359275375")]);
    const plan = await planImport(db, foreign, input([s]));
    expect(plan.counts.ready).toBe(1);
  });

  it("limits one import to 1,000 businesses", async () => {
    const rows = [HEAD, ...Array.from({ length: 1003 }, (_, i) => row(String(i), `Bulk ${i}`, `0301${String(1000000 + i)}`))];
    const plan = await planImport(db, mgr, input([sheet("Big", rows)], { country: "PK" }));
    expect(plan.counts.ready).toBe(1000);
    expect(plan.skipped.filter((s) => /limit/.test(s.reason))).toHaveLength(3);
  }, 120_000);
});
