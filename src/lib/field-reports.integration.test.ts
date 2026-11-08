// Field reports against hifi_one_test (decision 74): visits counted per agent and company day, against the target, with outcomes, demos,
// leads, no-location and impossible-travel checks; one agent's day as a route; the CSV; and nobody without field.review.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scheduleDemo } from "./demo-bookings";
import { agentDay, fieldReport, fieldVisitsCsv, reportRange } from "./field-reports";
import { recordVisit, saveProduct, setAgentProfile } from "./field-visits";
import { type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = 300; // Pakistan
const NOW = new Date("2026-11-09T06:30:00Z"); // Mon 9 Nov 11:30 local
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const fails = (p: Promise<unknown>, text: RegExp) => expect(p).rejects.toThrow(text);
let org: string, pharmivo: string;
let ali: Actor, sana: Actor, mgr: Actor, ona: Actor;
const at = (iso: string) => new Date(iso);
let n = 0;
const visit = (a: Actor, when: string, over: Record<string, unknown> = {}) => recordVisit(db, a, { name: `Shop ${++n}`, phone: `0300 77700${String(n).padStart(2, "0")}`, country: "PK", outcome: "OWNER_ABSENT", lat: 31.52 + n * 0.0003, lng: 74.35 + n * 0.0003, accuracyM: 10, visitedAt: at(when), ...over }, at(when));

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DemoBooking","ProspectVisit","SalesAgentProfile","SaasProduct","ProspectOutreach","ProspectSocial","ProspectWebsiteCheck","Prospect","ProspectSearch","SuppressedContact","LeadKey","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","CrmSettings","Client","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Report Org" } })).id;
  const mk = async (email: string, name: string) => (await db.user.create({ data: { organizationId: org, email, name, passwordHash: "x" } })).id;
  const [a, s, m, o] = await Promise.all([mk("ali@r.test", "Ali Field"), mk("sana@r.test", "Sana Field"), mk("mgr@r.test", "Mona Manager"), mk("ona@r.test", "Ona Onboarding")]);
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  ali = actor(a, org, ["crm.view", "crm.edit", "field.capture"]); sana = actor(s, org, ["crm.view", "crm.edit", "field.capture"]);
  mgr = actor(m, org, ["crm.view", "crm.edit", "crm.view_all", "field.capture", "field.review"]); ona = actor(o, org, ["crm.view", "prospector.schedule_demo"]);
  pharmivo = (await saveProduct(db, mgr, { name: "Pharmivo", businessLabel: "Pharmacy", dailyVisitTarget: 4 })).id;
  await setAgentProfile(db, mgr, { userId: ali.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: null });
  await setAgentProfile(db, mgr, { userId: sana.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: 2 });

  // Ali, Sunday 8 Nov local: four shops, one of them twice, one without location, one interested, one demo requested (booked the same day),
  // and a jump of ~30 km in five minutes between two of them
  await visit(ali, "2026-11-08T04:00:00Z"); // 09:00
  await visit(ali, "2026-11-08T04:30:00Z", { outcome: "INTERESTED" });
  const demo = await visit(ali, "2026-11-08T05:00:00Z", { outcome: "DEMO_REQUESTED", reason: "Any day" });
  await visit(ali, "2026-11-08T05:05:00Z", { lat: 31.80, lng: 74.35 }); // 30 km north five minutes later
  await visit(ali, "2026-11-08T06:00:00Z", { lat: null, lng: null, accuracyM: null });
  await visit(ali, "2026-11-08T07:00:00Z", { prospectId: demo.prospectId, outcome: "OWNER_ABSENT", clientRef: "again" }); // the same shop again: no new business
  await scheduleDemo(db, ona, demo.demoBookingId!, { scheduledAt: at("2026-11-12T06:00:00Z") }, at("2026-11-08T08:00:00Z"));
  // Ali, 23:50 Sunday local, which is 18:50 UTC on the 8th: must land on Sunday, not Monday
  await visit(ali, "2026-11-08T18:50:00Z");
  // Sana, Monday 9 Nov: two shops, one not interested
  await visit(sana, "2026-11-09T03:00:00Z");
  await visit(sana, "2026-11-09T03:20:00Z", { outcome: "NOT_INTERESTED", reason: "Has software" });
});
afterAll(async () => { await db.$disconnect(); });

describe("the period", () => {
  it("defaults to the last seven company days up to today, and reads a given range as whole local days", () => {
    const d = reportRange({ now: NOW, tzOffsetMinutes: TZ });
    expect(d.range).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(d.gte.toISOString()).toBe("2026-11-02T19:00:00.000Z"); // 3 Nov 00:00 in Pakistan
    expect(d.lt.toISOString()).toBe("2026-11-09T19:00:00.000Z");
    expect(reportRange({ from: "2026-11-08", to: "2026-11-08", tzOffsetMinutes: TZ, now: NOW }).range).toEqual({ from: "2026-11-08", to: "2026-11-08" });
    expect(reportRange({ from: "bad", to: "2026-11-01", tzOffsetMinutes: TZ, now: NOW }).range).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
});

describe("per agent and day", () => {
  it("counts a business once a day in the company's day, against the agent's target, with outcomes, demos, leads and the checks", async () => {
    const r = await fieldReport(db, mgr, { now: NOW, tzOffsetMinutes: TZ });
    expect(r.rows.map((x) => `${x.agentName} ${x.day}`)).toEqual(["Sana Field 2026-11-09", "Ali Field 2026-11-08"]);
    const sun = r.rows[1];
    expect(sun).toMatchObject({ visits: 6, entries: 7, target: 4, interested: 2, demosRequested: 1, leads: 1, noLocation: 1, fastTravel: 1, needsDetails: 0, productName: "Pharmivo" });
    expect(sun.outcomes).toEqual({ OWNER_ABSENT: 5, INTERESTED: 1, DEMO_REQUESTED: 1 });
    const mon = r.rows[0];
    expect(mon).toMatchObject({ visits: 2, target: 2, interested: 0, demosRequested: 0, leads: 0, noLocation: 0, fastTravel: 0 });
    expect(mon.outcomes).toEqual({ OWNER_ABSENT: 1, NOT_INTERESTED: 1 });
    expect(r.agents.map((a) => [a.agentName, a.visits, a.target])).toEqual([["Ali Field", 6, 4], ["Sana Field", 2, 2]]);
    expect(r.totals).toMatchObject({ visits: 8, businesses: 8, entries: 9, target: 6, interested: 2, demosRequested: 1, leads: 1, noLocation: 1, fastTravel: 1, days: 2 });
  });
  it("filters by agent, product and dates", async () => {
    expect((await fieldReport(db, mgr, { agentId: sana.id, now: NOW, tzOffsetMinutes: TZ })).rows.map((x) => x.agentName)).toEqual(["Sana Field"]);
    expect((await fieldReport(db, mgr, { productId: pharmivo, from: "2026-11-09", to: "2026-11-09", now: NOW, tzOffsetMinutes: TZ })).rows).toHaveLength(1);
    expect((await fieldReport(db, mgr, { from: "2026-11-01", to: "2026-11-07", now: NOW, tzOffsetMinutes: TZ })).rows).toHaveLength(0);
    expect((await fieldReport(db, mgr, { productId: "other", now: NOW, tzOffsetMinutes: TZ })).totals.visits).toBe(0);
  });
  it("is for sales managers only", async () => {
    await fails(fieldReport(db, ali, { now: NOW }), /sales manager/);
    await fails(agentDay(db, ona, ali.id, "2026-11-08"), /sales manager/);
    await fails(fieldVisitsCsv(db, sana, { now: NOW }), /sales manager/);
  });
});

describe("an agent's day", () => {
  it("lists the stops in order with their pins, a route link for the located ones, and the distance between them", async () => {
    const d = await agentDay(db, mgr, ali.id, "2026-11-08", { tzOffsetMinutes: TZ });
    expect(d.agentName).toBe("Ali Field");
    expect(d.stops).toHaveLength(7);
    expect(d.stops.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(d.located).toBe(6);
    expect(d.stops[4].lat).toBeNull();
    expect(d.pins).toHaveLength(6);
    for (const p of d.pins) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1); }
    expect(d.route).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/31\.52/);
    expect(d.routeTruncated).toBe(false);
    expect(d.distanceKm).toBeGreaterThan(55); // out 30 km and back
    expect(d.stops[2].leadId).toBeTruthy(); // the demo shop became a lead
  });
  it("a day with no visits is empty, not an error", async () => {
    const d = await agentDay(db, mgr, sana.id, "2026-11-08", { tzOffsetMinutes: TZ });
    expect(d.stops).toHaveLength(0);
    expect(d.route).toBeNull();
  });
});

describe("the spreadsheet", () => {
  it("has one row per visit in local time with the agent, product, business, outcome, location and lead", async () => {
    const csv = await fieldVisitsCsv(db, mgr, { from: "2026-11-08", to: "2026-11-08", tzOffsetMinutes: TZ, now: NOW });
    expect(csv.filename).toBe("field-visits-2026-11-08-to-2026-11-08");
    expect(csv.count).toBe(7);
    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]).toBe("Date and time,Agent,Product,Business,Phone,Email,Address,City,Outcome,Reason,Note,Latitude,Longitude,Accuracy (m),Photos,Prospect status,Lead");
    expect(lines[1]).toMatch(/^2026-11-08 09:00,Ali Field,Pharmivo,Shop 1,'\+923007770001,,,,Owner absent,,,31\.52/);
    expect(lines[3]).toMatch(/Demo requested,Any day,,31\.52.*,Converted,yes$/);
    expect(lines[5]).toMatch(/Owner absent,,,,,,0,/); // the one without a location
    expect(lines[7]).toMatch(/^2026-11-08 23:50,/);
  });
});
