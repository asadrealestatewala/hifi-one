// Field sales against hifi_one_test: products, agent profiles, visits (new, revisit, offline replay), the per-product duplicate rule,
// clients and leads refused, needs-details prospects, the day's count, and denied access.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { agentProfile, findMatches, metresBetween, recordVisit, revisitWhere, salesTeam, saveProduct, setAgentProfile, visitsToday } from "./field-visits";
import { addProspect } from "./prospect-manual";
import { logOutreach } from "./prospect-crm";
import { authorizeOwner, type FileActor } from "./file-access";
import { type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const NOW = new Date("2026-11-09T06:30:00Z"); // 11:30 in Pakistan
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
let org: string, pharmivo: string, agentify: string;
let ali: Actor, sana: Actor, desk: Actor, mgr: Actor, office: Actor, nobody: Actor;
const LAHORE = { lat: 31.5204, lng: 74.3587 };
const visit = (a: Actor, over: Record<string, unknown> = {}) => recordVisit(db, a, { name: "Al Shifa Pharmacy", phone: "0300 7770001", country: "PK", outcome: "OWNER_ABSENT", lat: LAHORE.lat, lng: LAHORE.lng, accuracyM: 12, ...over }, NOW);
const fails = (p: Promise<unknown>, text: RegExp) => expect(p).rejects.toThrow(text);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectVisit","SalesAgentProfile","SaasProduct","ProspectOutreach","ProspectSocial","ProspectWebsiteCheck","Prospect","ProspectSearch","SuppressedContact","LeadKey","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","CrmSettings","Client","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Field Org" } })).id;
  const mk = async (email: string, name: string) => (await db.user.create({ data: { organizationId: org, email, name, passwordHash: "x" } })).id;
  const [a, s, d, m, o, n] = await Promise.all([mk("ali@f.test", "Ali Field"), mk("sana@f.test", "Sana Field"), mk("desk@f.test", "Dua Desk"), mk("mgr@f.test", "Mona Manager"), mk("office@f.test", "Omar Office"), mk("nobody@f.test", "No Perms")]);
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  const field = ["crm.view", "crm.edit", "field.capture"];
  ali = actor(a, org, field); sana = actor(s, org, field); desk = actor(d, org, ["crm.view", "crm.edit"]); office = actor(o, org, field);
  mgr = actor(m, org, ["crm.view", "crm.edit", "crm.view_all", "field.capture", "field.review"]); nobody = actor(n, org, ["crm.view"]);
  // crm.edit holders for salesTeam(): a role with the permission
  const perm = await db.permission.create({ data: { key: "crm.edit", description: "t" } });
  const role = await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales Agent", permissions: { create: { permissionId: perm.id } } } });
  await db.userRole.createMany({ data: [a, s, d, o].map((userId) => ({ userId, roleId: role.id })) });
});
afterAll(async () => { await db.$disconnect(); });

describe("products", () => {
  it("a manager adds products; the code is derived, the target must be sensible, and codes are unique", async () => {
    pharmivo = (await saveProduct(db, mgr, { name: "Pharmivo", businessLabel: "Pharmacy", dailyVisitTarget: 40 })).id;
    agentify = (await saveProduct(db, mgr, { name: "Agentify ERP", code: "agentify", businessLabel: "Real estate agency", website: "https://agentifyerp.co", dailyVisitTarget: 30 })).id;
    expect((await db.saasProduct.findUniqueOrThrow({ where: { id: pharmivo } })).code).toBe("PHARMIVO");
    await fails(saveProduct(db, mgr, { name: "Velocity", businessLabel: "Car dealer", dailyVisitTarget: 9999 }), /0 to 500/);
    await fails(saveProduct(db, mgr, { name: "Other", code: "PHARMIVO", businessLabel: "x" }), /already exists/);
    await fails(saveProduct(db, mgr, { name: "", businessLabel: "x" }), /name/);
  });
  it("only field.review can change products or profiles", async () => {
    await fails(saveProduct(db, ali, { name: "Mine", businessLabel: "x" }), /sales manager/);
    await fails(setAgentProfile(db, ali, { userId: ali.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: null }), /sales manager/);
  });
});

describe("agent profiles", () => {
  it("a manager puts agents on a product as field or office, with an optional own target", async () => {
    await setAgentProfile(db, mgr, { userId: ali.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: null });
    await setAgentProfile(db, mgr, { userId: sana.id, productId: pharmivo, kind: "FIELD", dailyVisitTarget: "25" });
    await setAgentProfile(db, mgr, { userId: desk.id, productId: pharmivo, kind: "OFFICE", dailyVisitTarget: null });
    await setAgentProfile(db, mgr, { userId: office.id, productId: agentify, kind: "FIELD", dailyVisitTarget: null });
    expect(await agentProfile(db, org, ali.id)).toMatchObject({ productId: pharmivo, productName: "Pharmivo", kind: "FIELD", dailyVisitTarget: 40 });
    expect((await agentProfile(db, org, sana.id)).dailyVisitTarget).toBe(25);
    expect(await agentProfile(db, org, nobody.id)).toMatchObject({ productId: null, kind: "OFFICE", dailyVisitTarget: 40 });
    await fails(setAgentProfile(db, mgr, { userId: ali.id, productId: pharmivo, kind: "REMOTE", dailyVisitTarget: null }), /office or field/);
    await fails(setAgentProfile(db, mgr, { userId: ali.id, productId: "nope", kind: "FIELD", dailyVisitTarget: null }), /listed products/);
    const team = await salesTeam(db, org);
    expect(team.map((t) => t.name)).toEqual(["Ali Field", "Dua Desk", "Omar Office", "Sana Field"]);
    expect(team.find((t) => t.id === sana.id)).toMatchObject({ productId: pharmivo, kind: "FIELD", dailyVisitTarget: 25 });
  });
});

describe("recording a visit", () => {
  let first: string;
  it("saves the business as a prospect of the agent's product, assigned to the agent, with the visit and its location", async () => {
    const r = await visit(ali, { ownerName: "Dr Bilal", email: "Info@AlShifa.pk", address: "Main Blvd, Gulberg", reason: "Owner comes after 4pm", followUpOn: "2026-11-10", clientRef: "phone-1" });
    first = r.prospectId;
    expect(r).toMatchObject({ created: true, revisit: false, needsDetails: false, replayed: false, outcome: "OWNER_ABSENT", status: "ASSIGNED", alsoProspectFor: [] });
    const p = await db.prospect.findUniqueOrThrow({ where: { id: r.prospectId } });
    expect(p).toMatchObject({ origin: "MANUAL", sourceLabel: "FIELD_VISIT", captureKind: "FIELD", productId: pharmivo, status: "ASSIGNED", assignedToId: ali.id, addedById: ali.id, phone: "+923007770001", email: "info@alshifa.pk", contactName: "Dr Bilal", lastOutcome: "OWNER_ABSENT" });
    expect(Number(p.lat)).toBeCloseTo(LAHORE.lat, 4);
    const v = await db.prospectVisit.findUniqueOrThrow({ where: { id: r.visitId } });
    expect(v).toMatchObject({ agentId: ali.id, productId: pharmivo, outcome: "OWNER_ABSENT", reason: "Owner comes after 4pm", followUpOn: "2026-11-10", locationSource: "GPS", accuracyM: 12, clientRef: "phone-1" });
    expect(v.visitedAt.getTime()).toBe(NOW.getTime());
    expect(await db.lead.count()).toBe(0);
  });
  it("the same phone sent again with the same offline id is not saved twice", async () => {
    const r = await visit(ali, { clientRef: "phone-1", outcome: "CLOSED" });
    expect(r).toMatchObject({ prospectId: first, replayed: true, outcome: "OWNER_ABSENT" });
    expect(await db.prospectVisit.count({ where: { prospectId: first } })).toBe(1);
  });
  it("the same agent going back adds a visit to the same prospect instead of a second prospect, and the revisit list shows it", async () => {
    expect(await db.prospect.count({ where: revisitWhere(ali) })).toBe(1);
    const r = await visit(ali, { phone: "+92 300 7770001", outcome: "INTERESTED", note: "Wants to see stock module" });
    expect(r).toMatchObject({ prospectId: first, created: false, revisit: true, status: "CONTACTED" });
    expect(await db.prospectVisit.count({ where: { prospectId: first } })).toBe(2);
    expect(await db.prospect.count({ where: revisitWhere(ali) })).toBe(0);
    const p = await db.prospect.findUniqueOrThrow({ where: { id: first } });
    expect(p.notes).toContain("Wants to see stock module");
    expect(await db.prospectOutreach.count({ where: { prospectId: first, outcome: "CONTACTED" } })).toBe(1);
    expect(await db.lead.count()).toBe(0); // interested is still a prospect until the demo is booked
  });
  it("another field agent on the same product is told the business is already a prospect, by name", async () => {
    await fails(visit(sana, { phone: "03007770001" }), /Al Shifa Pharmacy is already a prospect for Pharmivo \(added 9 Nov 2026\) and belongs to another team member/);
    await fails(visit(sana, { phone: "", email: "info@alshifa.pk" }), /already a prospect for Pharmivo/);
    expect(await db.prospect.count()).toBe(1);
  });
  it("an office agent on the same product is refused too, with the business named", async () => {
    await fails(addProspect(db, desk, { name: "Al Shifa", phone: "0300 7770001", country: "PK", source: "OWN_CONTACT" }, NOW), /Al Shifa Pharmacy is already a prospect for Pharmivo/);
  });
  it("an agent on a different product may add the same business, and is told it is also a prospect elsewhere", async () => {
    const r = await visit(office, { name: "Al Shifa Pharmacy (owner also has plots)", outcome: "INTERESTED" });
    expect(r).toMatchObject({ created: true, alsoProspectFor: ["Pharmivo"] });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: r.prospectId } })).productId).toBe(agentify);
    expect(await db.prospect.count({ where: { phone: "+923007770001" } })).toBe(2);
  });
  it("an existing client or CRM lead is refused for any product", async () => {
    await db.client.create({ data: { organizationId: org, code: "C-0007", name: "Medix Pharmacy", phone: "0321-5550009", email: "hello@medix.pk" } });
    await fails(visit(ali, { name: "Medix", phone: "0321 5550009" }), /Medix Pharmacy \(C-0007\) is already a client/);
    await fails(visit(office, { name: "Medix", phone: "", email: "HELLO@medix.pk" }), /already a client/);
    await fails(addProspect(db, desk, { name: "Medix", phone: "03215550009", country: "PK", source: "OTHER" }, NOW), /already a client/);
    const stage = await db.pipelineStage.findFirstOrThrow();
    await db.lead.create({ data: { organizationId: org, name: "City Pharmacy", phone: "+923009990001", stageId: stage.id, assignedToId: sana.id } });
    await fails(visit(ali, { name: "City Pharmacy", phone: "0300 9990001" }), /lead with this phone number already exists/);
    expect(await db.prospect.count()).toBe(2);
  });
  it("a do-not-contact number is refused", async () => {
    await db.suppressedContact.create({ data: { organizationId: org, phone: "+923001110001", reason: "asked" } });
    await fails(visit(ali, { name: "Quiet Pharmacy", phone: "0300 1110001" }), /do-not-contact/);
  });
  it("refuses an unknown outcome, a bad number, a bad date and a visit older than a month", async () => {
    await fails(visit(ali, { outcome: "WENT_WELL" }), /what happened/);
    await fails(visit(ali, { phone: "12" }), /phone|number|short/i);
    await fails(visit(ali, { followUpOn: "tomorrow" }), /follow-up date/);
    await fails(visit(ali, { name: "Old", phone: "0300 2220002", visitedAt: "2026-09-01T10:00:00Z" }), /more than 30 days old/);
  });
});

describe("a visit without any phone or email", () => {
  let closed: string;
  it("is saved as a prospect that needs details and still counts; a time in the future is clamped and a bad location is dropped", async () => {
    const r = await visit(ali, { name: "Green Cross Pharmacy", phone: "", outcome: "CLOSED", reason: "Shutter down at 11:30", lat: 0, lng: 0, visitedAt: "2026-11-09T09:00:00Z" });
    closed = r.prospectId;
    expect(r).toMatchObject({ created: true, needsDetails: true, status: "ASSIGNED" });
    const v = await db.prospectVisit.findUniqueOrThrow({ where: { id: r.visitId } });
    expect(v).toMatchObject({ locationSource: "NONE", lat: null });
    expect(v.visitedAt.getTime()).toBe(NOW.getTime());
    expect((await db.prospect.findUniqueOrThrow({ where: { id: closed } })).phone).toBeNull();
  });
  it("is found again by its name nearby: the same agent revisits it and fills in the number", async () => {
    const r = await visit(ali, { name: "green cross pharmacy", phone: "0300 3330003", outcome: "INTERESTED", lat: LAHORE.lat + 0.0003, lng: LAHORE.lng });
    expect(r).toMatchObject({ prospectId: closed, revisit: true, needsDetails: false, status: "CONTACTED" });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: closed } })).phone).toBe("+923003330003");
  });
  it("without a number, another agent gets a 'looks like the same business' warning they can override as a different branch", async () => {
    const r1 = await visit(ali, { name: "Sehat Pharmacy", phone: "", outcome: "NOT_AVAILABLE" });
    await fails(visit(sana, { name: "SEHAT PHARMACY", phone: "", outcome: "CLOSED" }), /looks like the same business/);
    const far = await visit(sana, { name: "Sehat Pharmacy", phone: "", outcome: "CLOSED", lat: LAHORE.lat + 0.01, lng: LAHORE.lng }); // about 1.1 km away
    expect(far.prospectId).not.toBe(r1.prospectId);
    const branch = await visit(sana, { name: "Sehat Pharmacy", phone: "", outcome: "CLOSED", differentBusiness: true });
    expect(branch.prospectId).not.toBe(r1.prospectId);
    expect(metresBetween(LAHORE, { lat: LAHORE.lat + 0.01, lng: LAHORE.lng })).toBeGreaterThan(1000);
  });
  it("findMatches lists what was found for the screen", async () => {
    const m = await findMatches(db, sana, { phone: "+923007770001", email: null, productId: pharmivo });
    expect(m.map((x) => x.kind)).toEqual(["PROSPECT", "PROSPECT"]);
    expect(m.filter((x) => x.kind === "PROSPECT").map((x) => x.sameProduct)).toEqual([true, false]);
  });
});

describe("outcomes and statuses", () => {
  it("not interested closes the prospect and is in the CRM contact history; going back and finding interest reopens it", async () => {
    const r = await visit(sana, { name: "Noor Pharmacy", phone: "0300 4440004", outcome: "NOT_INTERESTED", reason: "Uses another software" });
    expect(r.status).toBe("NOT_INTERESTED");
    expect(await db.prospectOutreach.count({ where: { prospectId: r.prospectId, outcome: "NOT_INTERESTED" } })).toBe(1);
    const again = await visit(sana, { name: "Noor Pharmacy", phone: "0300 4440004", outcome: "DEMO_REQUESTED", note: "Tuesday 11am" });
    expect(again).toMatchObject({ prospectId: r.prospectId, status: "CONTACTED" });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: r.prospectId } })).lastOutcome).toBe("DEMO_REQUESTED");
  });
  it("a prospect that became a lead cannot take another visit; the lead carries the product", async () => {
    const r = await visit(sana, { name: "Lead Pharmacy", phone: "0300 5550005", outcome: "INTERESTED" });
    const log = await logOutreach(db, sana, r.prospectId, { outcome: "INTERESTED", now: NOW });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: log.leadId! } });
    expect(lead.tags).toContain("product:pharmivo");
    expect(lead.notes).toContain("Product: Pharmivo");
    await fails(visit(sana, { name: "Lead Pharmacy", phone: "0300 5550005", outcome: "CLOSED" }), /already a lead/);
  });
  it("an explicit revisit of someone else's prospect, or of another product's, is refused", async () => {
    const theirs = await db.prospect.findFirstOrThrow({ where: { addedById: ali.id, productId: pharmivo } });
    await fails(visit(sana, { prospectId: theirs.id, outcome: "CLOSED" }), /belongs to another team member/);
    const other = await db.prospect.findFirstOrThrow({ where: { productId: agentify } });
    await fails(visit(ali, { prospectId: other.id, outcome: "CLOSED" }), /different product/);
  });
});

describe("who may log visits", () => {
  it("needs field.capture, a field profile and an active product", async () => {
    await fails(visit(nobody), /permission/);
    await fails(visit(desk), /permission/);
    await setAgentProfile(db, mgr, { userId: desk.id, productId: pharmivo, kind: "OFFICE", dailyVisitTarget: null });
    const deskWithPerm = actor(desk.id, org, ["crm.view", "crm.edit", "field.capture"]);
    await fails(visit(deskWithPerm), /set to office work/);
    await setAgentProfile(db, mgr, { userId: nobody.id, productId: null, kind: "FIELD", dailyVisitTarget: null });
    await fails(visit(actor(nobody.id, org, ["crm.view", "crm.edit", "field.capture"])), /not on a product yet/);
    await db.saasProduct.update({ where: { id: agentify }, data: { active: false } });
    await fails(visit(office, { name: "Any", phone: "0300 6660006" }), /switched off/);
    await db.saasProduct.update({ where: { id: agentify }, data: { active: true } });
  });
  it("a manager with no profile logs a visit by choosing the product", async () => {
    await fails(visit(mgr, { name: "Mgr Pharmacy", phone: "0300 7770007" }), /not on a product yet/);
    const r = await visit(mgr, { name: "Mgr Pharmacy", phone: "0300 7770007", productId: pharmivo });
    expect(r.created).toBe(true);
  });
});

describe("the day's count", () => {
  it("counts businesses visited today once each, against the agent's target, in the agent's time zone", async () => {
    const t = await visitsToday(db, org, ali.id, { now: NOW, tzOffsetMinutes: 300 });
    expect(t).toMatchObject({ target: 40, product: "Pharmivo" });
    expect(t.count).toBe(3); // Al Shifa (visited twice), Green Cross (twice), Sehat
    expect(t.outcomes.OWNER_ABSENT).toBe(1);
    // Sana has her own target of 25
    expect((await visitsToday(db, org, sana.id, { now: NOW, tzOffsetMinutes: 300 })).target).toBe(25);
    // at 11:30 Pakistan time, a UTC day that began 5 hours earlier still holds the same visits; a day that started after them holds none
    expect((await visitsToday(db, org, ali.id, { now: new Date("2026-11-10T02:00:00Z"), tzOffsetMinutes: 300 })).count).toBe(0);
  });
});

describe("visit photos follow the visit", () => {
  const file = (id: string, perms: string[]): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
  it("the visiting agent and managers may read and add; other agents may not", async () => {
    const v = await db.prospectVisit.findFirstOrThrow({ where: { agentId: ali.id } });
    expect(await authorizeOwner(db, file(ali.id, ["crm.view", "crm.edit", "field.capture"]), "PROSPECT_VISIT", v.id, "read")).toBe(true);
    expect(await authorizeOwner(db, file(ali.id, ["crm.view", "crm.edit", "field.capture"]), "PROSPECT_VISIT", v.id, "upload")).toBe(true);
    expect(await authorizeOwner(db, file(mgr.id, ["crm.view", "crm.edit", "crm.view_all"]), "PROSPECT_VISIT", v.id, "read")).toBe(true);
    expect(await authorizeOwner(db, file(sana.id, ["crm.view", "crm.edit", "field.capture"]), "PROSPECT_VISIT", v.id, "read")).toBe(false);
    expect(await authorizeOwner(db, file(sana.id, ["crm.view", "crm.edit", "field.capture"]), "PROSPECT_VISIT", v.id, "upload")).toBe(false);
    expect(await authorizeOwner(db, { ...file(ali.id, ["crm.view"]), userType: "CLIENT" }, "PROSPECT_VISIT", v.id, "read")).toBe(false);
    expect(await authorizeOwner(db, file(ali.id, ["crm.view"]), "PROSPECT_VISIT", "missing", "read")).toBe(false);
  });
});

describe("photos, the agent's screen and the day boundary", () => {
  it("attaches up to 6 photos through the file service, skips a repeated upload by its hash, and reports what it refused", async () => {
    const { MemoryStorage } = await import("./storage");
    const { attachVisitPhotos } = await import("./field-visits");
    const storage = new MemoryStorage();
    const v = await db.prospectVisit.findFirstOrThrow({ where: { agentId: ali.id } });
    const jpg = (n: number) => Buffer.concat([Buffer.from("ffd8ffe000104a464946", "hex"), Buffer.alloc(64, n)]);
    const fa = { id: ali.id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["crm.view", "crm.edit", "field.capture"]) };
    const first = await attachVisitPhotos(db, storage, fa, v.id, [{ name: "card.jpg", bytes: jpg(1), category: "VISITING_CARD" }, { name: "front.jpg", bytes: jpg(2), category: "PREMISES" }, { name: "bad.txt", bytes: Buffer.from("hello"), category: "PREMISES" }]);
    expect(first).toMatchObject({ saved: 3, skipped: 0, errors: [] }); // a text file is a valid upload type; the phone only sends images anyway
    const again = await attachVisitPhotos(db, storage, fa, v.id, [{ name: "card.jpg", bytes: jpg(1), category: "VISITING_CARD" }, ...[3, 4, 5, 6, 7].map((n) => ({ name: `p${n}.jpg`, bytes: jpg(n), category: "PREMISES" }))]);
    expect(again).toMatchObject({ saved: 3, skipped: 1 });
    expect(again.errors[0]).toMatch(/Only 6 photos/);
    const files = await db.storedFile.findMany({ where: { ownerType: "PROSPECT_VISIT", ownerId: v.id } });
    expect(files.length).toBe(6);
    expect(files.map((f) => f.category).sort()).toEqual(["PREMISES", "PREMISES", "PREMISES", "PREMISES", "PREMISES", "VISITING_CARD"]);
    // another agent cannot add photos to a visit that is not theirs
    const v2 = await db.prospectVisit.findFirstOrThrow({ where: { agentId: ali.id, id: { not: v.id } } });
    const other = await attachVisitPhotos(db, storage, { ...fa, id: sana.id }, v2.id, [{ name: "x.jpg", bytes: jpg(9), category: "PREMISES" }]);
    expect(other.saved).toBe(0);
    expect(other.errors[0]).toMatch(/cannot add files/);
  });
  it("fieldHome gives the agent their product, count, revisits and today's visits with photo counts", async () => {
    const { fieldHome, zoneOffsetMinutes } = await import("./field-visits");
    const h = await fieldHome(db, ali, { now: NOW, tzOffsetMinutes: 300 });
    expect(h.profile.productName).toBe("Pharmivo");
    expect(h.today.count).toBe(3);
    expect(h.revisits.map((r) => r.name)).toEqual(["Sehat Pharmacy"]);
    expect(h.visits.length).toBe(5);
    expect(h.visits.reduce((n, v) => n + v.photos, 0)).toBe(6);
    expect(h.visits.some((v) => v.needsDetails)).toBe(true);
    expect(zoneOffsetMinutes("Asia/Karachi", NOW)).toBe(300);
    expect(zoneOffsetMinutes("UTC", NOW)).toBe(0);
    expect(zoneOffsetMinutes("Not/AZone", NOW)).toBe(0);
  });
});
