// The partner welcome email against hifi_one_test: it says what to sign in with and where, carries a 3-day link to choose a
// password, and staff can send it again with a fresh link. Suspended partners, other organisations and no mail account are refused.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { consumeReset, resetInfo } from "./accounts";
import { addPartner, ensurePartnerDefaults, sendPartnerWelcome } from "./partner-stack";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, officer: string, afaq: string, afaqUser: string;
const linkIn = (m: Outgoing) => /\/reset\/([A-Za-z0-9_-]+)/.exec(`${m.text}`)?.[1];

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PartnerPaymentNotice","ResaleCount","ResaleSchool","PartnerResaleTerm","PartnerPayoutAccount","PartnerIdentity","StoredFile","Client","NumberSequence","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailTemplate","EmailMessage","Notification","PasswordResetToken","Session","UserRole","Role","JobRun","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat", email: "pat@hifi.test", passwordHash: "x" } })).id;
  await ensurePartnerDefaults(db, org);
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

describe("partner welcome email", () => {
  it("tells a new partner what to sign in with, where, and what to do if the link expires", async () => {
    const a = await addPartner(db, { organizationId: org, actorId: officer, name: "Afaq Ur Rehman", email: "afaq@schools.test", phone: "03001112223", city: "Lahore", country: "Pakistan", typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY"], trainingOptional: false });
    afaq = a.id; afaqUser = a.userId!;
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe("afaq@schools.test");
    expect(m.text).toContain("Sign in with");
    expect(m.text).toContain("afaq@schools.test");
    expect(m.text).toMatch(/\/login\?for=partner/);
    expect(m.text).toMatch(/Forgot your password/);
    expect(m.text).toContain("HPS-0001");
    expect(m.html).toContain("Partner sign-in");
    expect(await resetInfo(db, linkIn(m)!)).toMatchObject({ email: "afaq@schools.test" });
  });
  it("staff can resend it with a fresh link; setting a password with one ends the others", async () => {
    const r = await sendPartnerWelcome(db, { organizationId: org, earnerId: afaq, actorId: officer });
    expect(r).toEqual({ to: "afaq@schools.test", status: "SENT" });
    expect(await db.passwordResetToken.count({ where: { userId: afaqUser, usedAt: null } })).toBe(2);
    const token = linkIn(sent[0])!;
    const u = await consumeReset(db, { token, password: "a-long-password-1" });
    expect(u.userType).toBe("PARTNER"); // the reset page sends partners to the partner sign-in page
    expect(await db.passwordResetToken.count({ where: { userId: afaqUser, usedAt: null } })).toBe(0);
  });
  it("is refused for another organisation, a suspended partner, and says so when no mail account is connected", async () => {
    await expect(sendPartnerWelcome(db, { organizationId: other, earnerId: afaq, actorId: officer })).rejects.toThrow(/Partner not found/);
    setTransportForTests(null); // no mail account in the test environment
    expect((await sendPartnerWelcome(db, { organizationId: org, earnerId: afaq, actorId: officer })).status).toBe("NOT_CONFIGURED");
    await db.earner.update({ where: { id: afaq }, data: { status: "SUSPENDED" } });
    await expect(sendPartnerWelcome(db, { organizationId: org, earnerId: afaq, actorId: officer })).rejects.toThrow(/suspended/);
    expect(sent).toHaveLength(0);
  });
});
