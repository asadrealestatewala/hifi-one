// Demo bookings against hifi_one_test (decision 73): a visit with Demo requested opens one request, the onboarding team books it and the
// prospect becomes the agent's lead through the shared conversion, moves and outcomes go on the lead's timeline, a cancelled request sends
// the shop back to the agent's go-back list, and nobody without prospector.schedule_demo can touch the queue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { closeDemo, demoQueue, leadFieldVisits, scheduleDemo, trainers } from "./demo-bookings";
import { fieldHome, recordVisit, revisitWhere, saveProduct, setAgentProfile } from "./field-visits";
import { authorizeOwner, type FileActor } from "./file-access";
import { type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const NOW = new Date("2026-11-09T06:30:00Z");
const LATER = new Date("2026-11-11T06:00:00Z"); // the demo: two days on, 11:00 in Pakistan
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const fails = (p: Promise<unknown>, text: RegExp) => expect(p).rejects.toThrow(text);
let org: string, pharmivo: string;
let ali: Actor, ona: Actor, tariq: Actor, mgr: Actor, nobody: Actor;
const LAHORE = { lat: 31.5204, lng: 74.3587 };
const visit = (a: Actor, over: Record<string, unknown> = {}) => recordVisit(db, a, { name: "Noor Pharmacy", phone: "0300 8880001", country: "PK", outcome: "DEMO_REQUESTED", reason: "Tuesday after 3pm", lat: LAHORE.lat, lng: LAHORE.lng, accuracyM: 10, ...over }, NOW);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DemoBooking","ProspectVisit","SalesAgentProfile","SaasProduct","ProspectOutreach","ProspectSocial","ProspectWebsiteCheck","Prospect","ProspectSearch","SuppressedContact","LeadKey","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","CrmSettings","Client","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Demo Org" } })).id;
  const mk = async (email: string, name: string) => (await db.user.create({ data: { organizationId: org, email, name, passwordHash: "x" } })).id;
  const [a, o, t, m, n] = await Promise.all([mk("ali@d.test", "Ali Field"), mk("ona@d.test", "Ona Onboarding"), mk("tariq@d.test", "Tariq Trainer"), mk("mgr@d.test", "Mona Manager"), mk("nobody@d.test", "No Perms")]);
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  ali = actor(a, org, ["crm.view", "crm.edit", "field.capture"]);
  ona = actor(o, org, ["crm.view", "prospector.schedule_demo"]); tariq = actor(t, org, ["crm.view", "prospector.schedule_demo"]);
  mgr = actor(m, org, ["crm.view", "crm.edit", "crm.view_all", "field.capture", "field.review"]); nobody = actor(n, org, ["crm.view"]);
  // the permission in the database too, so usersWithPermission() finds the onboarding team
  const perm = await db.permission.create({ data: { key: "prospector.schedule_demo", description: "t" } });
  const role = await db.role.create({ data: { organizationId: org, key: "ONBOARDING_SPECIALIST", name: "Onboarding Specialist", permissions: { create: { permissionId: perm.id } } } });
  await db.userRole.createMany({ data: [o, t].map((userId) => ({ userId, roleId: role.id })) });
  pharmivo = (await saveProduct(db, mgr, { name: "Pharmivo", businessLabel: "Pharmacy", dailyVisitTarget: 40 })).id;
  await setAgentProfile(db, mgr, { userId: ali.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: null });
});
afterAll(async () => { await db.$disconnect(); });

let bookingId: string, prospectId: string, leadId: string;

describe("asking for a demo", () => {
  it("a Demo requested visit opens one request with what the owner said, and tells the onboarding team", async () => {
    const r = await visit(ali);
    prospectId = r.prospectId;
    expect(r.demoBookingId).toBeTruthy();
    bookingId = r.demoBookingId!;
    const b = await db.demoBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ status: "REQUESTED", prospectId, productId: pharmivo, requestedById: ali.id, preferredNote: "Tuesday after 3pm", visitId: r.visitId });
    const told = await db.notification.findMany({ where: { kind: "demo.requested" }, select: { userId: true } });
    expect(told.map((n) => n.userId).sort()).toEqual([ona.id, tariq.id].sort());
  });
  it("asking again at the same shop adds to the note instead of a second request", async () => {
    const r = await visit(ali, { prospectId, reason: "Any morning", clientRef: "again-1" });
    expect(r.demoBookingId).toBe(bookingId);
    expect(await db.demoBooking.count({ where: { prospectId } })).toBe(1);
    expect((await db.demoBooking.findUniqueOrThrow({ where: { id: bookingId } })).preferredNote).toMatch(/Tuesday after 3pm\n.*Any morning/);
    expect(await db.notification.count({ where: { kind: "demo.requested" } })).toBe(2); // not rung twice
  });
  it("the queue shows it to the onboarding team, with who asked and the photos count; others are refused", async () => {
    const q = await demoQueue(db, ona, { tab: "requested" });
    expect(q.counts).toEqual({ requested: 1, scheduled: 0, done: 0 });
    expect(q.rows[0]).toMatchObject({ id: bookingId, requestedByName: "Ali Field", photos: 0, prospect: { name: "Noor Pharmacy", phone: "+923008880001" } });
    expect((await demoQueue(db, ona, { tab: "requested", q: "8880001" })).total).toBe(1);
    expect((await demoQueue(db, ona, { tab: "requested", q: "zzz" })).total).toBe(0);
    await fails(demoQueue(db, ali, {}), /onboarding team/);
    await fails(demoQueue(db, nobody, {}), /onboarding team/);
    expect((await trainers(db, org)).map((t) => t.name)).toEqual(["Ona Onboarding", "Tariq Trainer"]);
  });
  it("the agent sees the request waiting on their own screen", async () => {
    const home = await fieldHome(db, ali, { now: NOW });
    expect(home.demos).toHaveLength(1);
    expect(home.demos[0]).toMatchObject({ status: "REQUESTED", prospect: { name: "Noor Pharmacy" } });
  });
});

describe("booking the demo", () => {
  it("refuses a missing or past time, a stranger as trainer, and anyone without the permission", async () => {
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: "" }, NOW), /date and time/);
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: new Date("2026-11-01T06:00:00Z") }, NOW), /in the past/);
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: new Date("2027-11-01T06:00:00Z") }, NOW), /days ahead/);
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: LATER, trainerId: "not-a-user" }, NOW), /who gives the demo/);
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: LATER, mode: "PHONE" }, NOW), /at the business or online/);
    await fails(scheduleDemo(db, ali, bookingId, { scheduledAt: LATER }, NOW), /onboarding team/);
    await fails(scheduleDemo(db, mgr, bookingId, { scheduledAt: LATER }, NOW), /onboarding team/);
    expect((await db.demoBooking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("REQUESTED");
  });
  it("booking makes the lead for the agent who found it, with the product, source, appointment and visit history, and tells agent and trainer", async () => {
    const r = await scheduleDemo(db, ona, bookingId, { scheduledAt: LATER, trainerId: tariq.id, mode: "ON_SITE", note: "Ask for Mr Noor", timeZone: "Asia/Karachi" }, NOW);
    expect(r).toMatchObject({ bookingId, linkedExisting: false, rescheduled: false, owner: ali.id });
    leadId = r.leadId;
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { activities: true } });
    expect(lead).toMatchObject({ assignedToId: ali.id, createdById: ona.id, name: "Noor Pharmacy", phone: "+923008880001", source: "Prospector: Field visit" });
    expect(lead.tags).toEqual(expect.arrayContaining(["prospector", "product:pharmivo", "field-visit"]));
    expect(lead.notes).toContain("Product: Pharmivo");
    expect(lead.nextFollowUp?.toISOString()).toBe(LATER.toISOString());
    const kinds = lead.activities.map((a) => a.kind);
    expect(kinds).toContain("CREATED");
    expect(kinds).toContain("APPOINTMENT");
    expect(lead.activities.find((a) => a.kind === "APPOINTMENT")!.body).toMatch(/Demo booked for Wed,? 11 Nov, 11:00, at the business, given by Tariq Trainer\. Ask for Mr Noor/);
    expect(lead.activities.find((a) => a.kind === "NOTE")!.body).toMatch(/Contact history[\s\S]*Field visit: Demo requested/);
    const p = await db.prospect.findUniqueOrThrow({ where: { id: prospectId } });
    expect(p).toMatchObject({ status: "SENT_TO_CRM", leadId });
    expect(await db.demoBooking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "SCHEDULED", leadId, trainerId: tariq.id, scheduledById: ona.id, mode: "ON_SITE" });
    expect(await db.notification.findFirst({ where: { userId: ali.id, kind: "lead.assigned" } })).toMatchObject({ link: `/leads/${leadId}` });
    expect(await db.notification.findFirst({ where: { userId: tariq.id, kind: "demo.assigned" } })).toBeTruthy();
    // the agent's screen now shows the booked demo with the lead
    const home = await fieldHome(db, ali, { now: NOW });
    expect(home.demos[0]).toMatchObject({ status: "SCHEDULED", leadId });
    // and the lead page lists the visits behind it
    const visits = await leadFieldVisits(db, org, leadId);
    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({ outcome: "DEMO_REQUESTED", agentName: "Ali Field" });
  });
  it("the onboarding team may see the visit's photos; a stranger may not", async () => {
    const visitId = (await db.prospectVisit.findFirstOrThrow({ where: { prospectId } })).id;
    const fa = (a: Actor): FileActor => ({ id: a.id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: a.permissions });
    expect(await authorizeOwner(db, fa(ona), "PROSPECT_VISIT", visitId, "read")).toBe(true);
    expect(await authorizeOwner(db, fa(ali), "PROSPECT_VISIT", visitId, "read")).toBe(true);
    expect(await authorizeOwner(db, fa(nobody), "PROSPECT_VISIT", visitId, "read")).toBe(false);
    expect(await authorizeOwner(db, fa(ona), "PROSPECT_VISIT", visitId, "upload")).toBe(false);
  });
  it("moving the demo keeps the lead and adds a new appointment; a request cannot be marked done before it is booked", async () => {
    const moved = new Date("2026-11-12T05:00:00Z");
    const r = await scheduleDemo(db, ona, bookingId, { scheduledAt: moved, trainerId: ona.id, mode: "ONLINE", timeZone: "Asia/Karachi" }, NOW);
    expect(r).toMatchObject({ leadId, rescheduled: true });
    expect(await db.lead.count()).toBe(1);
    const apps = await db.leadActivity.findMany({ where: { leadId, kind: "APPOINTMENT" }, orderBy: { createdAt: "asc" } });
    expect(apps).toHaveLength(2);
    expect(apps[1].body).toMatch(/Demo moved to Thu,? 12 Nov, 10:00, online, given by Ona Onboarding/);
    expect(await db.notification.findFirst({ where: { userId: ali.id, kind: "demo.scheduled" } })).toBeTruthy();
  });
  it("done writes a meeting on the lead; a closed demo cannot be booked or closed again", async () => {
    const r = await closeDemo(db, ona, bookingId, { status: "DONE" }, LATER);
    expect(r).toMatchObject({ status: "DONE", leadId });
    expect(await db.leadActivity.findFirst({ where: { leadId, kind: "MEETING" } })).toMatchObject({ body: expect.stringMatching(/^Demo held/) });
    await fails(closeDemo(db, ona, bookingId, { status: "NO_SHOW" }, LATER), /already done/);
    await fails(scheduleDemo(db, ona, bookingId, { scheduledAt: LATER }, NOW), /cannot be booked again/);
    expect((await demoQueue(db, ona, { tab: "done" })).rows[0]).toMatchObject({ id: bookingId, status: "DONE", closedByName: "Ona Onboarding" });
  });
});

describe("cancelling and no shows", () => {
  let second: string, secondProspect: string;
  it("a request cancelled with a reason sends the shop back to the agent's go-back list and tells them", async () => {
    const r = await visit(ali, { name: "Sehat Medical Store", phone: "0300 8880002", clientRef: "second" });
    second = r.demoBookingId!; secondProspect = r.prospectId;
    await fails(closeDemo(db, ona, second, { status: "DONE" }, NOW), /not been booked yet/);
    await fails(closeDemo(db, ona, second, { status: "CANCELLED" }, NOW), /why/);
    await fails(closeDemo(db, ali, second, { status: "CANCELLED", reason: "x" }, NOW), /onboarding team/);
    const c = await closeDemo(db, ona, second, { status: "CANCELLED", reason: "Owner does not answer the phone" }, NOW);
    expect(c).toMatchObject({ status: "CANCELLED", leadId: null });
    const p = await db.prospect.findUniqueOrThrow({ where: { id: secondProspect } });
    expect(p).toMatchObject({ status: "CONTACTED", lastOutcome: "DEMO_CANCELLED", leadId: null });
    expect(p.notes).toContain("demo not booked: Owner does not answer the phone");
    const back = await db.prospect.findMany({ where: revisitWhere(ali), select: { id: true } });
    expect(back.map((x) => x.id)).toContain(secondProspect);
    expect(await db.notification.findFirst({ where: { userId: ali.id, kind: "demo.closed" } })).toMatchObject({ body: "Owner does not answer the phone", link: "/field" });
    // the agent can ask again later: a new request opens
    const again = await visit(ali, { prospectId: secondProspect, reason: "Try Friday", clientRef: "second-again" });
    expect(again.demoBookingId).not.toBe(second);
    second = again.demoBookingId!;
  });
  it("a no show after booking stays a lead and is written on its timeline", async () => {
    const r = await scheduleDemo(db, tariq, second, { scheduledAt: LATER, timeZone: "Asia/Karachi" }, NOW);
    expect(r.linkedExisting).toBe(false);
    const c = await closeDemo(db, tariq, second, { status: "NO_SHOW" }, LATER);
    expect(c.leadId).toBe(r.leadId);
    expect(await db.leadActivity.findFirst({ where: { leadId: r.leadId, kind: "MEETING", outcome: "NO_ANSWER" } })).toMatchObject({ body: expect.stringMatching(/^Demo missed/) });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: secondProspect } })).status).toBe("SENT_TO_CRM");
    expect(await db.notification.findFirst({ where: { userId: ali.id, kind: "demo.closed", link: `/leads/${r.leadId}` } })).toBeTruthy();
  });
  it("booking a demo for a business whose number is already a lead links that lead instead of making another", async () => {
    const existing = await db.lead.create({ data: { organizationId: org, name: "Old Lead", phone: "+923008880003", stageId: (await db.pipelineStage.findFirstOrThrow()).id, source: "Website" } });
    // a prospect with that number can be added only where the lead check does not catch it: make it directly, as an older office prospect would be
    const p = await db.prospect.create({ data: { organizationId: org, placeId: "visit:old", origin: "MANUAL", sourceLabel: "FIELD_VISIT", name: "Old Pharmacy", phone: "+923008880003", country: "PK", status: "CONTACTED", assignedToId: ali.id, productId: pharmivo } });
    const b = await db.demoBooking.create({ data: { organizationId: org, prospectId: p.id, productId: pharmivo, requestedById: ali.id, requestedAt: NOW } });
    const r = await scheduleDemo(db, ona, b.id, { scheduledAt: LATER, timeZone: "Asia/Karachi" }, NOW);
    expect(r).toMatchObject({ leadId: existing.id, linkedExisting: true });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).leadId).toBe(existing.id);
    expect(await db.leadActivity.count({ where: { leadId: existing.id, kind: "APPOINTMENT" } })).toBe(1);
  });
});
