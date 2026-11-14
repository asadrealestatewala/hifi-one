import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { usersWithPermission } from "./notifications";
import {
  PartnerError, approveApplication, certificatePdfFor, ensurePartnerDefaults, issueCertificate, publicProgramme, rejectApplication, renewCertificate, revokeCertificate,
  getSettings, samplePartnerCertificate, saveSettings, sendCertificateReminders, socialCardFor, submitApplication, submitInquiry, updateEarner, verifyCertificate,
} from "./partner-stack";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const DAY = 86_400_000;
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, manager: string, outsider: string;
const good = (over: Record<string, unknown> = {}) => ({ name: "Ayesha Khan", email: "Ayesha@Mail.test", phone: "+92 300 1234567", city: "Lahore", country: "Pakistan", professionKind: "FREELANCER", solutionCodes: ["AGENTIFY", "PHARMIVO"], typeKey: "RESELLER", terms: true, ...over });
const approval = (applicationId: string, over: Record<string, unknown> = {}) => ({ organizationId: org, applicationId, actorId: manager, typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, territory: "Lahore", solutionCodes: ["AGENTIFY", "PHARMIVO"], certifyCodes: ["AGENTIFY"], ...over });
const apply = async (over: Record<string, unknown> = {}) => { await submitApplication(db, { organizationId: org, input: good(over), ip: "1.2.3.4" }); return db.partnerApplication.findFirstOrThrow({ where: { organizationId: org }, orderBy: { createdAt: "desc" } }); };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","RolePermission","Permission","UserRole","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test", createdAt: new Date("2026-01-01") } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  const perm = await db.permission.create({ data: { key: "partners.manage", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "PARTNER_MANAGER", name: "Partner Manager" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  manager = (await db.user.create({ data: { organizationId: org, name: "Pat Manager", email: "pat@hifi.test", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
  outsider = (await db.user.create({ data: { organizationId: org, name: "Olly Outsider", email: "olly@hifi.test", passwordHash: "x" } })).id;
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

describe("programme defaults", () => {
  it("creates the earner types, the settings and all four Solutions including Campusly, once", async () => {
    await ensurePartnerDefaults(db, org);
    await ensurePartnerDefaults(db, org);
    const types = await db.earnerType.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } });
    expect(types.map((t) => [t.key, Number(t.defaultRate)])).toEqual([["STUDENT", 20], ["REFERRAL", 20], ["RESELLER", 30], ["EXCLUSIVE", 30], ["SALES_AGENT", 20]]);
    expect(types.filter((t) => t.academyRequired).map((t) => t.key)).toEqual(["STUDENT", "REFERRAL", "RESELLER"]);
    expect((await db.saasProduct.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } })).map((p) => p.code)).toEqual(["AGENTIFY", "VELOCITY", "PHARMIVO", "CAMPUSLY"]);
    const pub = await publicProgramme(db, org);
    expect(pub.types.map((t) => t.key)).toEqual(["STUDENT", "REFERRAL", "RESELLER", "EXCLUSIVE"]); // Sales Agent is internal
    expect(pub.settings.cert_expiry_days).toBe("30");
  });
  it("reads edited settings back and refuses nonsense", async () => {
    await saveSettings(db, { organizationId: org, actorId: manager, values: { cert_expiry_days: "45", "cert_expiry_days:AGENTIFY": "90" } });
    const s = await publicProgramme(db, org).then((p) => p.settings);
    expect(s.cert_expiry_days).toBe("45");
    expect(s["cert_expiry_days:AGENTIFY"]).toBe("90");
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { cert_expiry_days: "0" } })).rejects.toThrow(PartnerError);
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { cert_first_reminder_days: "2", cert_final_reminder_days: "3" } })).rejects.toThrow(/final reminder/i);
    await saveSettings(db, { organizationId: org, actorId: manager, values: { cert_expiry_days: "30", "cert_expiry_days:AGENTIFY": "" } });
    // Signatory and LinkedIn page number.
    await saveSettings(db, { organizationId: org, actorId: manager, values: { cert_signatory_name: "  Asad   B Zaman ", cert_signatory_title: "", linkedin_company_id: "12345" } });
    expect(await getSettings(db, org)).toMatchObject({ cert_signatory_name: "Asad B Zaman", linkedin_company_id: "12345" });
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { linkedin_company_id: "acme" } })).rejects.toThrow(/LinkedIn/);
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { cert_signatory_name: "x".repeat(81) } })).rejects.toThrow(/80/);
    expect(await samplePartnerCertificate(db, org, "TRAINING")).toBeInstanceOf(Buffer);
    expect(await samplePartnerCertificate(db, org, "AUTHORISATION")).toBeInstanceOf(Buffer);
    expect(await samplePartnerCertificate(db, org, "MODERN")).toBeNull();
    await saveSettings(db, { organizationId: org, actorId: manager, values: { cert_signatory_name: "", linkedin_company_id: "" } });
    expect((await publicProgramme(db, org)).settings["cert_expiry_days:AGENTIFY"]).toBeUndefined();
  });
});

describe("the inquiry form", () => {
  const input = { name: "Sara Ali", email: "sara@mail.test", phone: "03001234567", message: "How do payouts work?", interestedType: "RESELLER", city: "Karachi", country: "Pakistan", profession: "Teacher" };
  it("saves it, notifies only people who can manage partners, and auto-replies", async () => {
    await submitInquiry(db, { organizationId: org, input });
    const row = await db.partnerInquiry.findFirstOrThrow({ where: { organizationId: org } });
    expect(row.status).toBe("NEW");
    expect(row.email).toBe("sara@mail.test");
    expect((await db.notification.findMany({ where: { userId: manager } })).map((n) => n.kind)).toContain("partner.inquiry");
    expect(await db.notification.count({ where: { userId: outsider } })).toBe(0);
    expect(sent.some((m) => m.to === "sara@mail.test" && /received your question/i.test(m.subject))).toBe(true);
  });
  it("validates and drops bots without storing", async () => {
    const before = await db.partnerInquiry.count();
    await expect(submitInquiry(db, { organizationId: org, input: { ...input, email: "nope" } })).rejects.toMatchObject({ field: "email" });
    await expect(submitInquiry(db, { organizationId: org, input: { ...input, message: "hi" } })).rejects.toMatchObject({ field: "message" });
    await expect(submitInquiry(db, { organizationId: org, input: { ...input, phone: "" } })).rejects.toMatchObject({ field: "phone" });
    expect(await submitInquiry(db, { organizationId: org, input: { ...input, website_url: "http://spam" } })).toMatchObject({ ok: true, stored: false });
    expect(await db.partnerInquiry.count()).toBe(before);
  });
});

describe("the application form", () => {
  it("saves a valid application, tells the team and the applicant", async () => {
    const a = await apply();
    expect(a).toMatchObject({ status: "NEW", email: "ayesha@mail.test", typeKey: "RESELLER", solutionCodes: ["AGENTIFY", "PHARMIVO"], submissions: 1 });
    expect(a.termsIp).toBe("1.2.3.4");
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.application" } })).toBe(1);
    expect(sent.some((m) => m.to === "ayesha@mail.test" && /application/i.test(m.subject))).toBe(true);
  });
  it("needs the right fields for each profession and the terms", async () => {
    const fail = (over: Record<string, unknown>) => submitApplication(db, { organizationId: org, input: good({ email: "x@mail.test", ...over }) });
    await expect(fail({ professionKind: "EMPLOYED" })).rejects.toMatchObject({ field: "company" });
    await expect(fail({ professionKind: "EMPLOYED", company: "Acme" })).rejects.toMatchObject({ field: "jobTitle" });
    await expect(fail({ professionKind: "OTHER" })).rejects.toMatchObject({ field: "professionOther" });
    await expect(fail({ professionKind: "ASTRONAUT" })).rejects.toMatchObject({ field: "professionKind" });
    await expect(fail({ terms: false })).rejects.toMatchObject({ field: "terms" });
    await expect(fail({ solutionCodes: ["NOPE"] })).rejects.toMatchObject({ field: "solutionCodes" });
    await expect(fail({ typeKey: "SALES_AGENT" })).rejects.toMatchObject({ field: "typeKey" });
    await expect(fail({ city: "" })).rejects.toMatchObject({ field: "city" });
    await submitApplication(db, { organizationId: org, input: good({ email: "emp@mail.test", professionKind: "EMPLOYED", company: "Acme", jobTitle: "Analyst" }) });
    expect(await db.partnerApplication.findFirstOrThrow({ where: { email: "emp@mail.test" } })).toMatchObject({ company: "Acme", jobTitle: "Analyst" });
  });
  it("updates the open application when the same email applies again instead of adding another", async () => {
    await submitApplication(db, { organizationId: org, input: good({ email: "again@mail.test" }) });
    const r = await submitApplication(db, { organizationId: org, input: good({ email: "AGAIN@mail.test", city: "Multan" }) });
    expect(r).toMatchObject({ duplicate: true });
    const rows = await db.partnerApplication.findMany({ where: { email: "again@mail.test" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ city: "Multan", submissions: 2 });
  });
  it("ignores honeypot submissions", async () => {
    const before = await db.partnerApplication.count();
    expect(await submitApplication(db, { organizationId: org, input: good({ email: "bot@mail.test", website_url: "x" }) })).toMatchObject({ stored: false });
    expect(await db.partnerApplication.count()).toBe(before);
  });
});

describe("approval", () => {
  it("creates the partner, the login and training certificates for the Solutions ticked as trained only, then emails", async () => {
    const a = await apply({ email: "approve@mail.test" });
    sent.length = 0;
    const r = await approveApplication(db, approval(a.id, { ratePercent: "27.5", durationMonths: "12", leadSharing: true }));
    expect(r.certificates).toBe(1);
    const earner = await db.earner.findUniqueOrThrow({ where: { id: r.earnerId }, include: { solutions: { include: { product: true } }, certificates: { include: { product: true } }, type: true } });
    expect(earner).toMatchObject({ email: "approve@mail.test", territory: "Lahore", durationMonths: 12, leadSharing: true, status: "ACTIVE" });
    expect(Number(earner.ratePercent)).toBe(27.5);
    expect(earner.type.key).toBe("RESELLER");
    expect(earner.referralCode).toMatch(/^HP-/);
    expect(earner.solutions.map((s) => s.product.code).sort()).toEqual(["AGENTIFY", "PHARMIVO"]);
    expect(earner.certificates.map((c) => [c.product.code, c.kind, c.expiresAt])).toEqual([["AGENTIFY", "TRAINING", null]]);
    const user = await db.user.findUniqueOrThrow({ where: { id: earner.userId! } });
    expect(user).toMatchObject({ userType: "PARTNER", active: true, email: "approve@mail.test" });
    expect(await db.userRole.count({ where: { userId: user.id } })).toBe(0); // no staff roles, so no staff permissions
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("APPROVED");
    const welcome = sent.find((m) => /Welcome to Hifi Partner Stack/.test(m.subject))!;
    expect(welcome.text).toMatch(/\/reset\/[A-Za-z0-9_-]+/);
    const cert = sent.find((m) => /Agentify ERP training certificate/i.test(m.subject))!;
    expect(cert.text).toMatch(/Does not expire/);
    expect(cert.attachments?.[0].contentType).toBe("application/pdf");
    expect(cert.attachments?.[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });
  it("uses the partner's own validity, then the Solution's, then the global default", async () => {
    await saveSettings(db, { organizationId: org, actorId: manager, values: { cert_expiry_days: "30", "cert_expiry_days:PHARMIVO": "50" } });
    const a = await apply({ email: "valid@mail.test" });
    const now = new Date("2026-11-14T00:00:00Z");
    const r = await approveApplication(db, approval(a.id, { typeKey: "EXCLUSIVE", certifyCodes: ["AGENTIFY", "PHARMIVO"], now }));
    for (const solutionCode of ["AGENTIFY", "PHARMIVO"]) await issueCertificate(db, { organizationId: org, earnerId: r.earnerId, solutionCode, kind: "AUTHORISATION", actorId: manager, now });
    const certs = await db.partnerCertificate.findMany({ where: { earnerId: r.earnerId, kind: "AUTHORISATION" }, include: { product: true } });
    const days = Object.fromEntries(certs.map((c) => [c.product.code, Math.round((c.expiresAt!.getTime() - c.issuedAt.getTime()) / DAY)]));
    expect(days).toEqual({ AGENTIFY: 30, PHARMIVO: 50 });
    await updateEarner(db, { organizationId: org, earnerId: r.earnerId, typeKey: "RESELLER", ratePercent: "30", durationMonths: "", leadSharing: false, territory: "", certExpiryDays: "10", status: "ACTIVE", solutionCodes: ["AGENTIFY", "PHARMIVO"] });
    const c = await db.partnerCertificate.findFirstOrThrow({ where: { earnerId: r.earnerId, kind: "AUTHORISATION", product: { code: "AGENTIFY" } } });
    const renewed = await renewCertificate(db, { organizationId: org, id: c.id, actorId: manager, now });
    expect(Math.round((renewed.after.expiresAt!.getTime() - now.getTime()) / DAY)).toBe(10);
  });
  it("refuses a second decision, an existing login, a bad type or rate, and no Solutions", async () => {
    const a = await apply({ email: "twice@mail.test" });
    await expect(approveApplication(db, approval(a.id, { typeKey: "SALES_AGENT" }))).rejects.toMatchObject({ field: "typeKey" });
    await expect(approveApplication(db, approval(a.id, { ratePercent: "80" }))).rejects.toMatchObject({ field: "ratePercent" });
    await expect(approveApplication(db, approval(a.id, { solutionCodes: [], certifyCodes: [] }))).rejects.toMatchObject({ field: "solutionCodes" });
    await approveApplication(db, approval(a.id));
    await expect(approveApplication(db, approval(a.id))).rejects.toThrow(/already/);
    await expect(rejectApplication(db, { organizationId: org, applicationId: a.id, actorId: manager, reason: "too late" })).rejects.toThrow(/already/);
    const b = await apply({ email: "pat@hifi.test" }); // already a staff login
    await expect(approveApplication(db, approval(b.id))).rejects.toThrow(/already has an account/);
  });
  it("cannot approve an application of another organization", async () => {
    const a = await apply({ email: "scope@mail.test" });
    await expect(approveApplication(db, { ...approval(a.id), organizationId: other })).rejects.toMatchObject({ status: 404 });
  });
  it("two approvals at once create exactly one partner", async () => {
    const a = await apply({ email: "race@mail.test" });
    const results = await Promise.allSettled([approveApplication(db, approval(a.id)), approveApplication(db, approval(a.id))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.earner.count({ where: { email: "race@mail.test" } })).toBe(1);
  });
});

describe("the Partner ID", () => {
  it("is given in order at approval, per organization, and never repeats, even for approvals at the same moment", async () => {
    const numbers = (await db.earner.findMany({ where: { organizationId: org }, orderBy: { createdAt: "asc" }, select: { partnerNumber: true } })).map((e) => e.partnerNumber);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    const apps = [await apply({ email: "seq1@mail.test" }), await apply({ email: "seq2@mail.test" }), await apply({ email: "seq3@mail.test" })];
    await Promise.all(apps.map((a) => approveApplication(db, approval(a.id))));
    const all = (await db.earner.findMany({ where: { organizationId: org }, select: { partnerNumber: true } })).map((e) => e.partnerNumber).sort((a, b) => a - b);
    expect(all).toEqual(all.map((_, i) => i + 1));
    sent.length = 0;
    const last = await apply({ email: "seq4@mail.test" });
    const r = await approveApplication(db, approval(last.id));
    const e = await db.earner.findUniqueOrThrow({ where: { id: r.earnerId } });
    expect(e.partnerNumber).toBe(all.length + 1);
    expect(sent.find((m) => /Welcome to Hifi Partner Stack/.test(m.subject))!.text).toContain(`HPS-${String(all.length + 1).padStart(4, "0")}`);
  });
});

describe("rejection", () => {
  it("needs a reason, emails it, and keeps the history", async () => {
    const a = await apply({ email: "no@mail.test" });
    await expect(rejectApplication(db, { organizationId: org, applicationId: a.id, actorId: manager, reason: " " })).rejects.toMatchObject({ field: "reason" });
    sent.length = 0;
    await rejectApplication(db, { organizationId: org, applicationId: a.id, actorId: manager, reason: "Not onboarding in your city yet" });
    expect(await db.partnerApplication.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "REJECTED", decidedById: manager, decisionNote: "Not onboarding in your city yet" });
    expect(sent.find((m) => m.to === "no@mail.test")?.text).toContain("Not onboarding in your city yet");
    expect(await db.earner.count({ where: { email: "no@mail.test" } })).toBe(0);
  });
});

describe("certificates", () => {
  let earnerId: string, certId: string, publicId: string;
  beforeAll(async () => {
    const a = await apply({ email: "cert@mail.test", name: "Cert Holder" });
    earnerId = (await approveApplication(db, approval(a.id, { typeKey: "EXCLUSIVE" }))).earnerId;
    const c = await issueCertificate(db, { organizationId: org, earnerId, solutionCode: "AGENTIFY", kind: "AUTHORISATION", actorId: manager });
    certId = c.id; publicId = c.publicId;
  });
  it("needs training first: no certificate of authorisation without a valid training certificate for that Solution", async () => {
    await expect(issueCertificate(db, { organizationId: org, earnerId, solutionCode: "PHARMIVO", kind: "AUTHORISATION", actorId: manager })).rejects.toThrow(/training certificate first/);
    await expect(issueCertificate(db, { organizationId: org, earnerId, solutionCode: "PHARMIVO", kind: "GOLD", actorId: manager })).rejects.toThrow(PartnerError);
    const training = await db.partnerCertificate.findFirstOrThrow({ where: { earnerId, kind: "TRAINING", product: { code: "AGENTIFY" } } });
    await expect(renewCertificate(db, { organizationId: org, id: training.id, actorId: manager })).rejects.toThrow(/do not expire/);
    const v = await verifyCertificate(db, training.publicId, new Date(Date.now() + 4000 * DAY));
    expect(v).toMatchObject({ kind: "TRAINING", status: "VALID", expiresAt: null }); // training never expires
    expect((await certificatePdfFor(db, training.id, { organizationId: org, earnerId }))!.filename).toMatch(/Training-AGENTIFY/);
  });
  it("can be checked publicly and reveals only name, Solution, dates and status", async () => {
    const v = await verifyCertificate(db, publicId);
    expect(v).toMatchObject({ kind: "AUTHORISATION", partnerName: "Cert Holder", solution: "Agentify ERP", status: "VALID" });
    expect(Object.keys(v!).sort()).toEqual(["expiresAt", "issuedAt", "kind", "partnerId", "partnerName", "publicId", "revokedAt", "solution", "status"]);
    expect(v!.partnerId).toMatch(/^HPS-\d{4}$/);
    expect(JSON.stringify(v)).not.toMatch(/cert@mail|1234567|Lahore|referral/i);
    expect(await verifyCertificate(db, "HPS-AAAA-BBBB-CC")).toBeNull();
    expect(await verifyCertificate(db, "' OR 1=1 --")).toBeNull();
    expect((await verifyCertificate(db, publicId, new Date(Date.now() + 400 * DAY)))!.status).toBe("EXPIRED");
  });
  it("gives the social image only the public facts", async () => {
    const card = await socialCardFor(db, publicId);
    expect(card).toMatchObject({ partnerName: "Cert Holder", solutionName: "Agentify ERP", publicId, status: "VALID" });
    expect(Object.keys(card!).sort()).toEqual(["company", "kind", "partnerId", "partnerName", "partnerType", "publicId", "solutionName", "status", "validUntil"]);
    expect(JSON.stringify(card)).not.toMatch(/cert@mail|1234567|Lahore|referral/i);
    expect(await socialCardFor(db, "HPS-AAAA-BBBB-CC")).toBeNull();
  });
  it("renews with the same ID and a fresh period, and resets the reminders", async () => {
    await db.partnerCertificate.update({ where: { id: certId }, data: { firstReminderAt: new Date(), finalReminderAt: new Date() } });
    const now = new Date("2027-03-01T00:00:00Z");
    const { after } = await renewCertificate(db, { organizationId: org, id: certId, actorId: manager, now });
    expect(after).toMatchObject({ publicId, renewals: 1, firstReminderAt: null, finalReminderAt: null });
    expect(Math.round((after.expiresAt!.getTime() - now.getTime()) / DAY)).toBe(30);
    await expect(renewCertificate(db, { organizationId: org, id: certId, actorId: manager, days: "abc" })).rejects.toThrow(PartnerError);
  });
  it("will not issue a second valid certificate for the same Solution, nor one the partner may not sell", async () => {
    await expect(issueCertificate(db, { organizationId: org, earnerId, solutionCode: "AGENTIFY", kind: "AUTHORISATION", actorId: manager })).rejects.toThrow(/already holds/);
    await expect(issueCertificate(db, { organizationId: org, earnerId, solutionCode: "AGENTIFY", kind: "TRAINING", actorId: manager })).rejects.toThrow(/already holds a training/);
    await expect(issueCertificate(db, { organizationId: org, earnerId, solutionCode: "VELOCITY", kind: "TRAINING", actorId: manager })).rejects.toThrow(/not approved/);
    sent.length = 0;
    await issueCertificate(db, { organizationId: org, earnerId, solutionCode: "PHARMIVO", kind: "TRAINING", actorId: manager });
    await issueCertificate(db, { organizationId: org, earnerId, solutionCode: "PHARMIVO", kind: "AUTHORISATION", actorId: manager });
    expect(sent.some((m) => /Pharmivo training certificate/.test(m.subject))).toBe(true);
    expect(sent.some((m) => /Pharmivo certificate of authorisation/.test(m.subject))).toBe(true);
  });
  it("sends the 7-day reminder once, then the 1-day reminder once", async () => {
    const now = new Date("2027-06-01T00:00:00Z");
    await db.partnerCertificate.update({ where: { id: certId }, data: { expiresAt: new Date(now.getTime() + 5 * DAY), firstReminderAt: null, finalReminderAt: null, status: "ACTIVE" } });
    sent.length = 0;
    expect(await sendCertificateReminders(db, org, now)).toBeGreaterThanOrEqual(1);
    const mine = () => sent.filter((m) => m.to === "cert@mail.test" && /expires in/.test(m.subject));
    expect(mine()).toHaveLength(1);
    await sendCertificateReminders(db, org, new Date(now.getTime() + 3600_000));
    expect(mine()).toHaveLength(1); // not again
    const later = new Date(now.getTime() + 4.5 * DAY);
    await sendCertificateReminders(db, org, later);
    expect(mine()).toHaveLength(2); // the final one
    await sendCertificateReminders(db, org, new Date(later.getTime() + 3600_000));
    expect(mine()).toHaveLength(2);
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.certificate_expiring" } })).toBeGreaterThanOrEqual(2);
  });
  it("sends no reminder for revoked or already expired certificates", async () => {
    const now = new Date("2027-06-01T00:00:00Z");
    await db.partnerCertificate.update({ where: { id: certId }, data: { expiresAt: new Date(now.getTime() + 2 * DAY), firstReminderAt: null, finalReminderAt: null } });
    await revokeCertificate(db, { organizationId: org, id: certId, actorId: manager, reason: "Left the programme" });
    sent.length = 0;
    await sendCertificateReminders(db, org, now);
    expect(sent.filter((m) => m.to === "cert@mail.test" && /expires in/.test(m.subject))).toHaveLength(0);
  });
  it("revoking needs a reason, shows as revoked publicly, and cannot be renewed", async () => {
    await expect(revokeCertificate(db, { organizationId: org, id: certId, actorId: manager, reason: "x" })).rejects.toThrow();
    expect((await verifyCertificate(db, publicId))).toMatchObject({ status: "REVOKED" });
    await expect(renewCertificate(db, { organizationId: org, id: certId, actorId: manager })).rejects.toThrow(/revoked/);
    await expect(revokeCertificate(db, { organizationId: org, id: certId, actorId: manager, reason: "again please" })).rejects.toThrow(/Already/);
  });
  it("a suspended partner's certificates stop verifying, and the portal PDF lookup is scoped to the earner", async () => {
    const a = await apply({ email: "susp@mail.test" });
    const r = await approveApplication(db, approval(a.id, { typeKey: "EXCLUSIVE" }));
    const c = await issueCertificate(db, { organizationId: org, earnerId: r.earnerId, solutionCode: "AGENTIFY", kind: "AUTHORISATION", actorId: manager });
    expect((await verifyCertificate(db, c.publicId))!.status).toBe("VALID");
    expect(await certificatePdfFor(db, c.id, { organizationId: org, earnerId: earnerId })).toBeNull(); // someone else's earner id
    expect(await certificatePdfFor(db, c.id, { organizationId: other, earnerId: r.earnerId })).toBeNull(); // another organization
    expect((await certificatePdfFor(db, c.id, { organizationId: org, earnerId: r.earnerId }))!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await updateEarner(db, { organizationId: org, earnerId: r.earnerId, typeKey: "RESELLER", ratePercent: "30", durationMonths: "", leadSharing: false, territory: "", certExpiryDays: "", status: "SUSPENDED", solutionCodes: ["AGENTIFY"] });
    expect((await verifyCertificate(db, c.publicId))!.status).toBe("REVOKED");
    const user = await db.user.findUniqueOrThrow({ where: { id: (await db.earner.findUniqueOrThrow({ where: { id: r.earnerId } })).userId! } });
    expect(user.active).toBe(false);
    await expect(renewCertificate(db, { organizationId: org, id: c.id, actorId: manager })).rejects.toThrow(/suspended/);
  });
});

describe("who is told and who is shut out", () => {
  it("only holders of partners.manage get alerts", async () => {
    expect(await usersWithPermission(db, org, "partners.manage")).toEqual([manager]);
  });
  it("partner logins carry no staff roles, so the staff app has nothing to grant them", async () => {
    const partners = await db.user.findMany({ where: { organizationId: org, userType: "PARTNER" }, include: { roles: true } });
    expect(partners.length).toBeGreaterThan(3);
    for (const p of partners) expect(p.roles).toHaveLength(0);
  });
});
