// Staff correcting a partner's contact details against hifi_one_test: the email is also the sign-in email, so it moves on the
// User and the billing client too, both addresses are told, and a verified identity locks the name.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { setResaleTerm } from "./partner-resale";
import { addPartner, ensurePartnerDefaults, updateContactDetails } from "./partner-stack";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, officer: string, imran: string, imranUser: string;
const base = { phone: "03001112223", city: "Lahore", country: "Pakistan" };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PartnerPaymentNotice","ResaleCount","ResaleSchool","PartnerResaleTerm","PartnerPayoutAccount","PartnerIdentity","StoredFile","Client","NumberSequence","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","UserRole","Role","JobRun","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat", email: "pat@hifi.test", passwordHash: "x" } })).id;
  await ensurePartnerDefaults(db, org);
  const a = await addPartner(db, { organizationId: org, actorId: officer, name: "Muhammad Imran", email: "imran@schools.test", ...base, typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY"], trainingOptional: false });
  imran = a.id; imranUser = a.userId!;
  await db.user.update({ where: { id: imranUser }, data: { passwordHash: "kept-hash", emailVerifiedAt: new Date() } });
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

const edit = (over: Record<string, string> = {}) => updateContactDetails(db, { organizationId: org, earnerId: imran, actorId: officer, name: "Muhammad Imran", email: "imran@schools.test", ...base, ...over });

describe("edit contact details", () => {
  it("checks the input and the organisation", async () => {
    await expect(edit({ email: "not-an-email" })).rejects.toThrow(/valid email/);
    await expect(edit({ phone: "12" })).rejects.toThrow(/phone/);
    await expect(edit({ name: "M" })).rejects.toThrow(/name/);
    await expect(updateContactDetails(db, { organizationId: other, earnerId: imran, actorId: officer, name: "X Y", email: "x@y.test", ...base })).rejects.toThrow(/Partner not found/);
    await expect(edit({ email: "pat@hifi.test" })).rejects.toThrow(/already has an account/);
  });
  it("changes phone and city without touching the sign-in or sending email", async () => {
    const r = await edit({ phone: "0321 555 6666", city: "Islamabad" });
    expect(r.emailChanged).toBe(false);
    expect(r.after).toMatchObject({ phone: "03215556666", city: "Islamabad" });
    expect(sent).toHaveLength(0);
  });
  it("a new email becomes the sign-in email, keeps the password, and both addresses are told", async () => {
    const r = await edit({ email: " Imran.New@Schools.test " });
    expect(r.emailChanged).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { id: imranUser } });
    expect(u).toMatchObject({ email: "imran.new@schools.test", passwordHash: "kept-hash", emailVerifiedAt: null });
    expect((await db.earner.findUniqueOrThrow({ where: { id: imran } })).email).toBe("imran.new@schools.test");
    expect(sent.map((m) => m.to).sort()).toEqual(["imran.new@schools.test", "imran@schools.test"]);
    expect(sent[0].subject).toMatch(/sign-in email was changed/);
  });
  it("the billing client follows the email; a verified identity locks the name", async () => {
    await db.partnerIdentity.create({ data: { organizationId: org, earnerId: imran, legalName: "Muhammad Imran", idType: "CNIC", idNumberEnc: "x", idLast4: "5671", address: "Lahore", status: "VERIFIED", submittedAt: new Date(), reviewedAt: new Date() } });
    await setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: { model: "RESALE", collection: "PARTNER_COLLECTS", unitName: "student", currency: "PKR", wholesalePrice: "20", resalePrice: "", paymentTermsDays: "10", effectiveFrom: "2099-01" } });
    await edit({ email: "imran@group.test" });
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran } });
    expect((await db.client.findUniqueOrThrow({ where: { id: e.billingClientId! } })).email).toBe("imran@group.test");
    await expect(edit({ name: "Imran Ahmed", email: "imran@group.test" })).rejects.toThrow(/verified under "Muhammad Imran"/);
    await db.partnerIdentity.update({ where: { earnerId: imran }, data: { status: "REJECTED" } });
    expect((await edit({ name: "Imran Ahmed", email: "imran@group.test" })).after.name).toBe("Imran Ahmed");
    expect((await db.user.findUniqueOrThrow({ where: { id: imranUser } })).name).toBe("Imran Ahmed");
  });
});
