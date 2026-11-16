// Partner identity checks, payout accounts and adding a partner directly, against hifi_one_test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { setTransportForTests, type Outgoing } from "./mailer";
import {
  addPayoutAccount, approvePayoutAccount, payoutReadiness, removePayoutAccount, revealIdNumber, revealPayoutAccount, reviewIdentity, saveIdentityDocument,
  sendIdentityRecheckReminders, setDefaultPayoutAccount, submitIdentity,
} from "./partner-identity";
import { addPartner, ensurePartnerDefaults, submitInquiry } from "./partner-stack";
import { MemoryStorage } from "./storage";

process.env.SESSION_SECRET ??= "test-secret-".padEnd(48, "x");
const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const png = () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(40, 1)]);
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, officer: string, verifier: string, managerOnly: string;
let earnerId: string, partnerUser: string, otherEarner: string;

const actor = (id: string, userType: string, perms: string[]): FileActor => ({ id, organizationId: org, userType, clientId: null, vendorId: null, permissions: new Set(perms) });
const asPartner = () => actor(partnerUser, "PARTNER", []);
const identityInput = (over: Record<string, unknown> = {}) => ({ legalName: "Muhammad Imran", idType: "CNIC", idNumber: "35202-1234567-1", address: "House 12, Street 4, Model Town, Lahore", businessName: "Bright Schools (Pvt) Ltd", ntn: "1234567-8", activeTaxpayer: true, ...over });
const partnerInput = (over: Record<string, unknown> = {}) => ({
  organizationId: org, actorId: officer, name: "Muhammad Imran", email: "imran@schools.test", phone: "0300 1112223", city: "Lahore", country: "Pakistan", typeKey: "RESELLER", ratePercent: "30",
  durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY"], trainingOptional: true, trainingReason: "Runs a group of schools and resells Campusly", ...over,
});

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PartnerPayoutAccount","PartnerIdentity","StoredFile","AuditLog","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","RolePermission","Permission","UserRole","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  const manage = await db.permission.create({ data: { key: "partners.manage", description: "x" } });
  const view = await db.permission.create({ data: { key: "partners.view_identity", description: "x" } });
  const pm = await db.role.create({ data: { organizationId: org, key: "PARTNER_MANAGER", name: "Partner Manager" } });
  const helper = await db.role.create({ data: { organizationId: org, key: "HELPER", name: "Helper" } });
  await db.rolePermission.createMany({ data: [{ roleId: pm.id, permissionId: manage.id }, { roleId: pm.id, permissionId: view.id }, { roleId: helper.id, permissionId: manage.id }] });
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat Officer", email: "pat@hifi.test", passwordHash: "x", roles: { create: { roleId: pm.id } } } })).id;
  verifier = (await db.user.create({ data: { organizationId: org, name: "Vera Verifier", email: "vera@hifi.test", passwordHash: "x", roles: { create: { roleId: pm.id } } } })).id;
  managerOnly = (await db.user.create({ data: { organizationId: org, name: "Max Manager", email: "max@hifi.test", passwordHash: "x", roles: { create: { roleId: helper.id } } } })).id;
  await ensurePartnerDefaults(db, org);
  await ensurePartnerDefaults(db, other);
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

describe("adding a partner directly", () => {
  it("makes the partner from an inquiry, closes it, records training optional, and emails a set-password link", async () => {
    await submitInquiry(db, { organizationId: org, input: { name: "Muhammad Imran", email: "imran@schools.test", phone: "03001112223", message: "I own several schools and want to resell Campusly.", interestedType: "RESELLER" } });
    const inquiry = await db.partnerInquiry.findFirstOrThrow({ where: { organizationId: org } });
    sent.length = 0;
    const e = await addPartner(db, partnerInput({ inquiryId: inquiry.id }));
    earnerId = e.id;
    partnerUser = e.userId!;
    expect(e).toMatchObject({ inquiryId: inquiry.id, academyDirectAccess: true, directAccessReason: "Runs a group of schools and resells Campusly", directAccessById: officer, partnerNumber: 1 });
    expect((await db.partnerInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("CLOSED");
    expect((await db.user.findUniqueOrThrow({ where: { id: partnerUser } })).userType).toBe("PARTNER");
    const mail = sent.find((m) => m.to === "imran@schools.test");
    expect(mail?.html).toMatch(/\/reset\//);
    await expect(addPartner(db, partnerInput({ inquiryId: inquiry.id, email: "second@schools.test" }))).rejects.toThrow(/already made into a partner/);
  });
  it("refuses a missing reason for optional training, a taken email and a Sales Agent", async () => {
    await expect(addPartner(db, partnerInput({ email: "x@schools.test", trainingReason: "" }))).rejects.toThrow(/why training is optional/);
    await expect(addPartner(db, partnerInput())).rejects.toThrow(/already has an account/);
    await expect(addPartner(db, partnerInput({ email: "y@schools.test", typeKey: "SALES_AGENT" }))).rejects.toThrow(/Choose Student/);
    const plain = await addPartner(db, partnerInput({ name: "Sara Khan", email: "sara@partner.test", trainingOptional: false, trainingReason: "" }));
    expect(plain.academyDirectAccess).toBe(false);
    otherEarner = plain.id;
  });
});

describe("ID pictures", () => {
  it("the partner adds and sees their own; other partners and staff without the permission cannot", async () => {
    const f = await saveIdentityDocument(db, storage, { actor: asPartner(), earnerId, category: "FRONT", name: "cnic-front.png", bytes: png() });
    expect(f.ownerType).toBe("PARTNER_IDENTITY");
    const sara = await db.earner.findUniqueOrThrow({ where: { id: otherEarner } });
    expect(await authorizeOwner(db, asPartner(), "PARTNER_IDENTITY", earnerId, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(sara.userId!, "PARTNER", []), "PARTNER_IDENTITY", earnerId, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(managerOnly, "EMPLOYEE", ["partners.manage"]), "PARTNER_IDENTITY", earnerId, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(officer, "EMPLOYEE", ["partners.view_identity"]), "PARTNER_IDENTITY", earnerId, "read")).toBe(true);
    expect(await authorizeOwner(db, { ...actor(officer, "EMPLOYEE", ["partners.view_identity"]), organizationId: other }, "PARTNER_IDENTITY", earnerId, "read")).toBe(false);
  });
  it("accepts only JPG, PNG or PDF up to 5 MB, and a new picture replaces the old one of the same side", async () => {
    await expect(saveIdentityDocument(db, storage, { actor: asPartner(), earnerId, category: "BACK", name: "back.docx", bytes: png() })).rejects.toThrow(/JPG, PNG or PDF/);
    await expect(saveIdentityDocument(db, storage, { actor: asPartner(), earnerId, category: "BACK", name: "back.png", bytes: Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]) })).rejects.toThrow(/too large/);
    await saveIdentityDocument(db, storage, { actor: asPartner(), earnerId, category: "FRONT", name: "cnic-front-2.png", bytes: png() });
    const live = await db.storedFile.findMany({ where: { ownerId: earnerId, ownerType: "PARTNER_IDENTITY", deletedAt: null } });
    expect(live.map((f) => f.filename)).toEqual(["cnic-front-2.png"]);
  });
});

describe("identity check", () => {
  it("needs both sides of the CNIC before it can be sent", async () => {
    await expect(submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput() })).rejects.toThrow(/CNIC back/);
    await saveIdentityDocument(db, storage, { actor: asPartner(), earnerId, category: "BACK", name: "cnic-back.png", bytes: png() });
  });
  it("stores the number encrypted, shows only the last four, and tells only the people who may see identities", async () => {
    const { after } = await submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput() });
    expect(after).toMatchObject({ status: "SUBMITTED", idLast4: "5671", activeTaxpayer: true });
    expect(after.idNumberEnc).not.toContain("35202");
    expect(await revealIdNumber(db, org, earnerId)).toBe("35202-1234567-1");
    expect(await revealIdNumber(db, other, earnerId)).toBeNull();
    expect(await db.notification.count({ where: { kind: "partner.identity", userId: officer } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "partner.identity", userId: managerOnly } })).toBe(0);
  });
  it("keeps the number on file when the field is left empty, and refuses a bad one", async () => {
    await submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput({ idNumber: "" }) });
    expect(await revealIdNumber(db, org, earnerId)).toBe("35202-1234567-1");
    await expect(submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput({ idNumber: "1234" }) })).rejects.toThrow(/13-digit/);
  });
  it("a rejection needs a reason the partner sees; verification sets the yearly re-check and emails the partner", async () => {
    await expect(reviewIdentity(db, { organizationId: org, earnerId, actorId: verifier, decision: "REJECT", reason: "" })).rejects.toThrow(/correct/);
    const r = await reviewIdentity(db, { organizationId: org, earnerId, actorId: verifier, decision: "REJECT", reason: "The back picture is blurred." });
    expect(r.after).toMatchObject({ status: "REJECTED", rejectReason: "The back picture is blurred." });
    expect(sent.some((m) => m.to === "imran@schools.test" && /needs changes/.test(m.subject))).toBe(true);
    await expect(reviewIdentity(db, { organizationId: org, earnerId, actorId: verifier, decision: "VERIFY" })).rejects.toThrow(/waiting for review/);
    await submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput({ idNumber: "" }) });
    const now = new Date("2026-11-16T10:00:00Z");
    const v = await reviewIdentity(db, { organizationId: org, earnerId, actorId: verifier, decision: "VERIFY", now });
    expect(v.after.status).toBe("VERIFIED");
    expect(v.after.recheckDueAt?.toISOString()).toBe(new Date(now.getTime() + 365 * DAY).toISOString());
  });
});

describe("payout accounts", () => {
  const t0 = new Date("2026-11-16T12:00:00Z");
  let jazz: string, bank: string;
  it("a new account matching the verified name is held 48 hours, staff are told and the partner gets a security email", async () => {
    const a = await addPayoutAccount(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, now: t0, input: { method: "JAZZCASH", accountTitle: "MUHAMMAD IMRAN", account: "0300 1112223" } });
    jazz = a.id;
    expect(a).toMatchObject({ isDefault: true, titleMatches: true, accountLast4: "2223" });
    expect(a.accountEnc).not.toContain("03001112223");
    expect(a.usableFrom.getTime() - t0.getTime()).toBe(48 * HOUR);
    expect(await revealPayoutAccount(db, { organizationId: org, earnerId, accountId: a.id })).toBe("03001112223");
    expect(await db.notification.count({ where: { kind: "partner.payout_account", userId: managerOnly } })).toBe(1);
    expect(sent.some((m) => m.to === "imran@schools.test" && /payout account was added/.test(m.subject))).toBe(true);
    const early = await payoutReadiness(db, { organizationId: org, earnerId, now: new Date(t0.getTime() + HOUR) });
    expect(early.ready).toBe(false);
    expect(early.reasons.join(" ")).toMatch(/safety hold/);
    const later = await payoutReadiness(db, { organizationId: org, earnerId, now: new Date(t0.getTime() + 49 * HOUR) });
    expect(later).toMatchObject({ ready: true, reasons: [] });
    expect(later.account?.id).toBe(a.id);
  });
  it("refuses the same account twice and an invalid IBAN", async () => {
    await expect(addPayoutAccount(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: { method: "JAZZCASH", accountTitle: "Muhammad Imran", account: "+923001112223" } })).rejects.toThrow(/already saved/);
    await expect(addPayoutAccount(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: { method: "BANK", bankName: "Meezan", accountTitle: "Muhammad Imran", account: "PK12" } })).rejects.toThrow(/IBAN/);
  });
  it("a business account matches the verified business name; another title needs approval by someone other than who added it", async () => {
    const b = await addPayoutAccount(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, now: t0, input: { method: "BANK", bankName: "Meezan Bank", accountTitle: "M/S BRIGHT SCHOOLS PRIVATE LIMITED", account: "PK36MEZN0000001123456702" } });
    bank = b.id;
    expect(b).toMatchObject({ titleMatches: true, isDefault: false });
    const odd = await addPayoutAccount(db, { organizationId: org, earnerId, actorId: officer, byStaff: true, now: t0, input: { method: "OTHER", otherName: "Payoneer", accountTitle: "Imran Traders", account: "PAYO-998877" } });
    expect(odd.titleMatches).toBe(false);
    await expect(approvePayoutAccount(db, { organizationId: org, earnerId, accountId: odd.id, actorId: officer })).rejects.toThrow(/Someone other/);
    await setDefaultPayoutAccount(db, { organizationId: org, earnerId, accountId: odd.id });
    const blocked = await payoutReadiness(db, { organizationId: org, earnerId, now: new Date(t0.getTime() + 3 * DAY) });
    expect(blocked.reasons.join(" ")).toMatch(/needs approval/);
    await approvePayoutAccount(db, { organizationId: org, earnerId, accountId: odd.id, actorId: verifier });
    expect((await payoutReadiness(db, { organizationId: org, earnerId, now: new Date(t0.getTime() + 3 * DAY) })).ready).toBe(true);
    await expect(approvePayoutAccount(db, { organizationId: org, earnerId, accountId: bank, actorId: verifier })).rejects.toThrow(/does not need/);
    // Removing the default makes the oldest remaining account the default
    await removePayoutAccount(db, { organizationId: org, earnerId, accountId: odd.id, actorId: partnerUser });
    expect((await db.partnerPayoutAccount.findUniqueOrThrow({ where: { id: jazz } })).isDefault).toBe(true);
  });
  it("cannot touch another partner's or another organisation's accounts", async () => {
    await expect(removePayoutAccount(db, { organizationId: org, earnerId: otherEarner, accountId: jazz, actorId: officer })).rejects.toThrow(/not found/);
    await expect(setDefaultPayoutAccount(db, { organizationId: other, earnerId, accountId: bank })).rejects.toThrow(/not found/);
    await expect(addPayoutAccount(db, { organizationId: other, earnerId, actorId: officer, byStaff: true, input: { method: "PAYPAL", accountTitle: "x", account: "a@b.co" } })).rejects.toThrow(/Partner not found/);
  });
  it("a partner without a verified identity is not ready for payouts", async () => {
    const r = await payoutReadiness(db, { organizationId: org, earnerId: otherEarner });
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(["Identity: not submitted.", "No payout account."]);
  });
  it("updating a verified identity sends it back to review and pauses payouts", async () => {
    await submitIdentity(db, { organizationId: org, earnerId, actorId: partnerUser, byStaff: false, input: identityInput({ idNumber: "", address: "New address, Gulberg III, Lahore" }) });
    const r = await payoutReadiness(db, { organizationId: org, earnerId, now: new Date(t0.getTime() + 3 * DAY) });
    expect(r.reasons[0]).toMatch(/waiting for review/);
    await reviewIdentity(db, { organizationId: org, earnerId, actorId: verifier, decision: "VERIFY", now: new Date("2026-11-16T10:00:00Z") });
  });
});

describe("yearly re-check reminder", () => {
  it("emails once, 30 days before the re-check is due", async () => {
    const due = (await db.partnerIdentity.findUniqueOrThrow({ where: { earnerId } })).recheckDueAt!;
    expect(await sendIdentityRecheckReminders(db, org, new Date(due.getTime() - 31 * DAY))).toBe(0);
    expect(await sendIdentityRecheckReminders(db, org, new Date(due.getTime() - 29 * DAY))).toBe(1);
    expect(await sendIdentityRecheckReminders(db, org, new Date(due.getTime() - 20 * DAY))).toBe(0);
    expect(sent.filter((m) => /confirm your partner details/.test(m.subject))).toHaveLength(1);
  });
});
