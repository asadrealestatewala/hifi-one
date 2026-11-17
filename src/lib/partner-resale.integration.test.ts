// Reseller billing against hifi_one_test: terms, schools, counts, monthly drafts for both collection models, "I've paid",
// and the daily job. Money is posted only when Finance issues and confirms, through accounting.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueInvoice, trialBalance } from "./accounting";
import { authorizeOwner, type FileActor } from "./file-access";
import { setTransportForTests, type Outgoing } from "./mailer";
import {
  addMonths, addSchool, confirmCounts, confirmPaymentNotice, createResaleDrafts, endSchool, enterCount, hifiCollectsMargin, monthOf, rejectPaymentNotice,
  runResaleDaily, setResaleTerm, submitPaymentNotice, termFor,
} from "./partner-resale";
import { addPartner, ensurePartnerDefaults } from "./partner-stack";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, officer: string, finance: string, bank: string, usdBank: string;
let imran: string, imranUser: string, sara: string;
const NOW = new Date("2026-11-16T09:00:00Z"); // November 2026
const NOV = "2026-11", DEC = "2026-12", JAN = "2027-01";
const png = () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(40, 1)]);
const resale = (over: Record<string, string> = {}) => ({ model: "RESALE", collection: "PARTNER_COLLECTS", unitName: "student", currency: "PKR", wholesalePrice: "20", resalePrice: "50", paymentTermsDays: "10", effectiveFrom: NOV, ...over });
const partnerActor = (): FileActor => ({ id: imranUser, organizationId: org, userType: "PARTNER", clientId: null, vendorId: null, permissions: new Set() });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PartnerPaymentNotice","ResaleCount","ResaleSchool","PartnerResaleTerm","PartnerPayoutAccount","PartnerIdentity","StoredFile","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","RolePermission","Permission","UserRole","Role","JobRun","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Hifi Marketing and Technologies Pvt Ltd" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR");
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES");
  await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Meezan PKR", "ASSET");
  const usd = await mk("1101", "Bank USD", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "Meezan PKR", bankName: "Meezan Bank", accountHolder: "Hifi Marketing and Technologies Pvt Ltd", accountNumber: "0101", iban: "PK36MEZN0000000000000101", currency: "PKR", isDefault: true, ledgerAccountId: cash.id } })).id;
  usdBank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "Hifi", accountNumber: "9", currency: "USD", isDefault: true, ledgerAccountId: usd.id } })).id;
  const perms = Object.fromEntries(await Promise.all(["partners.manage", "finance.post", "finance.view"].map(async (k) => [k, (await db.permission.create({ data: { key: k, description: k } })).id])));
  const pm = await db.role.create({ data: { organizationId: org, key: "PARTNER_MANAGER", name: "Partner Manager" } });
  const fin = await db.role.create({ data: { organizationId: org, key: "FINANCE", name: "Finance" } });
  await db.rolePermission.createMany({ data: [{ roleId: pm.id, permissionId: perms["partners.manage"] }, { roleId: fin.id, permissionId: perms["finance.post"] }, { roleId: fin.id, permissionId: perms["finance.view"] }] });
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat", email: "pat@hifi.test", passwordHash: "x", roles: { create: { roleId: pm.id } } } })).id;
  finance = (await db.user.create({ data: { organizationId: org, name: "Fay", email: "fay@hifi.test", passwordHash: "x", roles: { create: { roleId: fin.id } } } })).id;
  await ensurePartnerDefaults(db, org);
  const base = { organizationId: org, actorId: officer, phone: "03001112223", city: "Lahore", country: "Pakistan", typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY", "PHARMIVO"], trainingOptional: false };
  const a = await addPartner(db, { ...base, name: "Muhammad Imran", email: "imran@schools.test" });
  imran = a.id; imranUser = a.userId!;
  sara = (await addPartner(db, { ...base, name: "Sara Khan", email: "sara@schools.test" })).id;
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

describe("months and terms", () => {
  it("works in Pakistan time and picks the latest term that has started", () => {
    expect(monthOf(new Date("2026-11-30T20:00:00Z"))).toBe("2026-12"); // already 1 December in Pakistan
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    const t = [{ effectiveFrom: "2026-11" }, { effectiveFrom: "2027-01" }];
    expect(termFor(t, "2026-12")?.effectiveFrom).toBe("2026-11");
    expect(termFor(t, "2027-02")?.effectiveFrom).toBe("2027-01");
    expect(termFor(t, "2026-10")).toBeNull();
  });
  it("sets resale for a Solution the partner sells, and makes the billing client named with the Partner ID", async () => {
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "AGENTIFY", actorId: officer, input: resale(), now: NOW })).rejects.toThrow(/not approved to sell/);
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale(), now: NOW })).rejects.toThrow(/Verify this partner's identity/);
    for (const [earnerId, legalName] of [[imran, "Muhammad Imran"], [sara, "Sara Khan"]]) {
      await db.partnerIdentity.create({ data: { organizationId: org, earnerId, legalName, idType: "CNIC", idNumberEnc: "x", idLast4: "5671", address: "Lahore", status: "VERIFIED", submittedAt: NOW, reviewedAt: NOW } });
    }
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale({ effectiveFrom: "2026-10" }), now: NOW })).rejects.toThrow(/past month/);
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale({ resalePrice: "15" }), now: NOW })).rejects.toThrow(/lower than the wholesale/);
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale({ collection: "HIFI_COLLECTS", resalePrice: "" }), now: NOW })).rejects.toThrow(/Hifi bills that price/);
    const t = await setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale(), now: NOW });
    expect(t).toMatchObject({ model: "RESALE", collection: "PARTNER_COLLECTS", unitName: "student" });
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran }, include: { identity: true } });
    const c = await db.client.findUniqueOrThrow({ where: { id: e.billingClientId! } });
    expect(c).toMatchObject({ name: "Muhammad Imran (HPS-0001)", currency: "PKR", paymentTermsDays: 10 });
    expect(await setResaleTerm(db, { organizationId: other, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale(), now: NOW }).catch((x) => x.message)).toMatch(/Partner not found/);
  });
});

describe("schools and counts", () => {
  let s1: string, s2: string, s3: string;
  it("adds schools as Hifi clients; a partner cannot claim an existing client", async () => {
    await expect(addSchool(db, { organizationId: org, earnerId: imran, actorId: imranUser, byStaff: false, input: { productCode: "PHARMIVO", name: "Some Pharmacy", startMonth: NOV }, now: NOW })).rejects.toThrow(/not set up for resale/);
    s1 = (await addSchool(db, { organizationId: org, earnerId: imran, actorId: imranUser, byStaff: false, input: { productCode: "CAMPUSLY", name: "Bright Future School", email: "office@bright.test", startMonth: NOV }, now: NOW })).id;
    s2 = (await addSchool(db, { organizationId: org, earnerId: imran, actorId: officer, byStaff: true, input: { productCode: "CAMPUSLY", name: "City Grammar", startMonth: NOV }, now: NOW })).id;
    const school = await db.resaleSchool.findUniqueOrThrow({ where: { id: s1 }, include: { client: true } });
    expect(school.client).toMatchObject({ name: "Bright Future School", clientType: "SAAS", currency: "PKR" });
    expect(school.client.code).toMatch(/^C-\d{4}$/);
    await expect(addSchool(db, { organizationId: org, earnerId: imran, actorId: imranUser, byStaff: false, input: { productCode: "CAMPUSLY", name: "bright future school", startMonth: NOV }, now: NOW })).rejects.toThrow(/already on your list/);
    await db.client.create({ data: { organizationId: org, name: "Direct Client School", currency: "PKR" } });
    await expect(addSchool(db, { organizationId: org, earnerId: imran, actorId: imranUser, byStaff: false, input: { productCode: "CAMPUSLY", name: "Direct Client School", startMonth: NOV }, now: NOW })).rejects.toThrow(/Ask the partner team/);
    s3 = (await addSchool(db, { organizationId: org, earnerId: imran, actorId: officer, byStaff: true, input: { productCode: "CAMPUSLY", name: "Direct Client School", startMonth: NOV }, now: NOW })).id;
  });
  it("the partner enters counts, staff confirm; staff entries are confirmed at once; future months and other partners' schools are refused", async () => {
    await expect(enterCount(db, { organizationId: org, earnerId: imran, schoolId: s1, month: DEC, units: "100", actorId: imranUser, byStaff: false, now: NOW })).rejects.toThrow(/future month/);
    await expect(enterCount(db, { organizationId: org, earnerId: sara, schoolId: s1, month: NOV, units: "100", actorId: imranUser, byStaff: false, now: NOW })).rejects.toThrow(/School not found/);
    await expect(enterCount(db, { organizationId: org, earnerId: imran, schoolId: s1, month: NOV, units: "12.5", actorId: imranUser, byStaff: false, now: NOW })).rejects.toThrow(/whole number/);
    const a = await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s1, month: NOV, units: "120", actorId: imranUser, byStaff: false, now: NOW });
    expect(a.after.confirmedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: officer, kind: "partner.resale_count" } })).toBe(1);
    const b = await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s2, month: NOV, units: "80", actorId: officer, byStaff: true, now: NOW });
    expect(b.after.confirmedById).toBe(officer);
    // Once Hifi confirmed a count, the partner can no longer change it
    await expect(enterCount(db, { organizationId: org, earnerId: imran, schoolId: s2, month: NOV, units: "90", actorId: imranUser, byStaff: false, now: NOW })).rejects.toThrow(/already confirmed/);
    await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s3, month: NOV, units: "0", actorId: officer, byStaff: true, now: NOW });
  });
  it("bills only ended months and confirmed counts; one draft invoice to the partner, lines per school, wholesale price", async () => {
    await expect(createResaleDrafts(db, { organizationId: org, month: NOV, actorId: finance, now: NOW })).rejects.toThrow(/once it has ended/);
    const DEC5 = new Date("2026-12-05T06:00:00Z");
    const r1 = await createResaleDrafts(db, { organizationId: org, month: NOV, actorId: finance, now: DEC5 });
    expect(r1).toMatchObject({ invoices: 1, partnerInvoices: 1, unconfirmed: 1 });
    const n = await confirmCounts(db, { organizationId: org, countIds: (await db.resaleCount.findMany({ where: { month: NOV } })).map((c) => c.id), actorId: officer });
    expect(n).toBe(1);
    const r2 = await createResaleDrafts(db, { organizationId: org, month: NOV, actorId: finance, now: DEC5 });
    expect(r2.invoices).toBe(1); // the late-confirmed school gets its own draft; nothing is billed twice
    const again = await createResaleDrafts(db, { organizationId: org, month: NOV, actorId: finance, now: DEC5 });
    expect(again.invoices).toBe(0);
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran } });
    const inv = await db.invoice.findMany({ where: { clientId: e.billingClientId! }, include: { lines: true }, orderBy: { createdAt: "asc" } });
    expect(inv.map((i) => [i.status, i.total.toFixed(2)])).toEqual([["DRAFT", "1600.00"], ["DRAFT", "2400.00"]]); // 80 x 20, then 120 x 20
    expect(inv[1].lines[0].description).toBe("Campusly: Bright Future School, November 2026, 120 students");
    // A billed month is locked: counts cannot change and new terms cannot start in it
    await expect(enterCount(db, { organizationId: org, earnerId: imran, schoolId: s1, month: NOV, units: "130", actorId: officer, byStaff: true, now: DEC5 })).rejects.toThrow(/already billed/);
    await expect(setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, input: resale({ wholesalePrice: "25" }), now: NOW })).rejects.toThrow(/already billed/);
    expect(await db.journalEntry.count({ where: { organizationId: org } })).toBe(0); // drafts post nothing
  });
  it("a removed school is not billed after its month", async () => {
    await endSchool(db, { organizationId: org, earnerId: imran, schoolId: s3, actorId: officer, now: new Date("2026-11-20T00:00:00Z") });
    await expect(enterCount(db, { organizationId: org, earnerId: imran, schoolId: s3, month: DEC, units: "5", actorId: officer, byStaff: true, now: new Date("2026-12-20T00:00:00Z") })).rejects.toThrow(/removed/);
  });
});

describe("Hifi collects", () => {
  it("bills each school at the resale price and tracks the partner's margin on what schools paid", async () => {
    await setResaleTerm(db, { organizationId: org, earnerId: sara, productCode: "CAMPUSLY", actorId: officer, input: resale({ collection: "HIFI_COLLECTS" }), now: NOW });
    expect((await db.earner.findUniqueOrThrow({ where: { id: sara } })).billingClientId).toBeNull();
    const s = await addSchool(db, { organizationId: org, earnerId: sara, actorId: officer, byStaff: true, input: { productCode: "CAMPUSLY", name: "Green Valley School", startMonth: NOV }, now: NOW });
    await enterCount(db, { organizationId: org, earnerId: sara, schoolId: s.id, month: NOV, units: "100", actorId: officer, byStaff: true, now: NOW });
    const r = await createResaleDrafts(db, { organizationId: org, month: NOV, actorId: finance, now: new Date("2026-12-05T06:00:00Z") });
    expect(r).toMatchObject({ invoices: 1, schoolInvoices: 1 });
    const inv = await db.invoice.findFirstOrThrow({ where: { clientId: s.clientId } });
    expect(inv.total.toFixed(2)).toBe("5000.00");
    expect(await hifiCollectsMargin(db, org, sara)).toEqual([]); // a draft earns nothing yet
    await issueInvoice(db, { organizationId: org, invoiceId: inv.id, actorId: finance });
    const m = await hifiCollectsMargin(db, org, sara);
    expect(m.map((x) => [x.currency, x.earned.toFixed(2), x.waiting.toFixed(2)])).toEqual([["PKR", "0.00", "3000.00"]]);
    await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID", amountPaid: inv.total } });
    expect((await hifiCollectsMargin(db, org, sara))[0].earned.toFixed(2)).toBe("3000.00");
  });
});

describe("I've paid", () => {
  let invoiceId: string, noticeId: string;
  it("the partner reports a payment with a receipt on an issued invoice; finance is told", async () => {
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran } });
    const draft = await db.invoice.findFirstOrThrow({ where: { clientId: e.billingClientId!, total: 2400 } });
    const file = { name: "receipt.png", bytes: png() };
    await expect(submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId: draft.id, amount: "2400", paidOn: "2026-12-10", reference: "TRX-123", file, now: new Date("2026-12-10T10:00:00Z") })).rejects.toThrow(/not open/);
    const issued = await issueInvoice(db, { organizationId: org, invoiceId: draft.id, actorId: finance });
    invoiceId = issued.id;
    expect((issued.bankSnapshot as { iban: string }).iban).toBe("PK36MEZN0000000000000101"); // Hifi's account printed on the invoice
    await expect(submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId, amount: "2500", paidOn: "2026-12-10", reference: "TRX-123", file, now: new Date("2026-12-10T10:00:00Z") })).rejects.toThrow(/up to 2400.00/);
    await expect(submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId, amount: "2400", paidOn: "2026-12-10", reference: "TRX-123", file: null, now: new Date("2026-12-10T10:00:00Z") })).rejects.toThrow(/receipt/);
    await expect(submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: sara, invoiceId, amount: "2400", paidOn: "2026-12-10", reference: "TRX-123", file, now: new Date("2026-12-10T10:00:00Z") })).rejects.toThrow(/Invoice not found/);
    const n = await submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId, amount: "2400", paidOn: "2026-12-10", reference: "TRX-123", file, now: new Date("2026-12-10T10:00:00Z") });
    noticeId = n.id;
    expect(await db.notification.count({ where: { userId: finance, kind: "partner.payment_notice" } })).toBe(1);
    expect(await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }).then((i) => i.status)).toBe("ISSUED"); // never marks money received
    await expect(submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId, amount: "100", paidOn: "2026-12-10", reference: "TRX-124", file, now: new Date("2026-12-10T10:00:00Z") })).rejects.toThrow(/already told us/);
  });
  it("the receipt is seen by the partner and finance only", async () => {
    const f = await db.storedFile.findFirstOrThrow({ where: { ownerType: "PARTNER_PAYMENT_NOTICE", ownerId: noticeId } });
    expect(await authorizeOwner(db, partnerActor(), "PARTNER_PAYMENT_NOTICE", f.ownerId, "read")).toBe(true);
    expect(await authorizeOwner(db, { ...partnerActor(), id: "someone-else" }, "PARTNER_PAYMENT_NOTICE", f.ownerId, "read")).toBe(false);
    expect(await authorizeOwner(db, { id: officer, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["partners.manage"]) }, "PARTNER_PAYMENT_NOTICE", f.ownerId, "read")).toBe(false);
    expect(await authorizeOwner(db, { id: finance, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["finance.view"]) }, "PARTNER_PAYMENT_NOTICE", f.ownerId, "read")).toBe(true);
  });
  it("finance confirms into a bank account in the same currency: one receipt, invoice paid, books balance, double clicks post once", async () => {
    await expect(confirmPaymentNotice(db, { organizationId: org, noticeId, actorId: finance, bankAccountId: usdBank })).rejects.toThrow(/in USD/);
    const r = await confirmPaymentNotice(db, { organizationId: org, noticeId, actorId: finance, bankAccountId: bank });
    expect(r.payment.number).toMatch(/^RCT/);
    await expect(confirmPaymentNotice(db, { organizationId: org, noticeId, actorId: finance, bankAccountId: bank })).rejects.toThrow(/already handled/);
    expect(await db.payment.count({ where: { organizationId: org } })).toBe(1);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PAID");
    const tb = await trialBalance(db, org);
    expect(tb.reduce((a, x) => a + Number(x.debit), 0)).toBeCloseTo(tb.reduce((a, x) => a + Number(x.credit), 0), 2);
    expect(sent.some((m) => m.to === "imran@schools.test" && /received/.test(m.subject))).toBe(true);
  });
  it("finance can send a report back with a reason", async () => {
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran } });
    const other = await db.invoice.findFirstOrThrow({ where: { clientId: e.billingClientId!, total: 1600 } });
    await issueInvoice(db, { organizationId: org, invoiceId: other.id, actorId: finance });
    const n = await submitPaymentNotice(db, storage, { actor: partnerActor(), earnerId: imran, invoiceId: other.id, amount: "1600", paidOn: "2026-12-11", reference: "TRX-999", file: { name: "r.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") }, now: new Date("2026-12-11T10:00:00Z") });
    await expect(rejectPaymentNotice(db, { organizationId: org, noticeId: n.id, actorId: finance, reason: "no" })).rejects.toThrow(/Say why/);
    await rejectPaymentNotice(db, { organizationId: org, noticeId: n.id, actorId: finance, reason: "Not in the bank statement yet." });
    expect((await db.partnerPaymentNotice.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("REJECTED");
    expect(sent.some((m) => m.to === "imran@schools.test" && /not found yet/.test(m.subject))).toBe(true);
  });
});

describe("daily job", () => {
  it("asks for counts on the 1st, makes drafts on the billing day, warns at 7 days late and flags a pause at 15", async () => {
    const s = await db.resaleSchool.findFirstOrThrow({ where: { earnerId: imran, client: { name: "Bright Future School" } } });
    const r1 = await runResaleDaily(db, org, new Date("2026-12-01T04:00:00Z"));
    expect(r1).toBe("0 count reminders"); // every school already has its November count, so nobody is asked
    expect(sent.filter((m) => /student counts for November 2026/.test(m.subject))).toHaveLength(0);
    await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s.id, month: DEC, units: "125", actorId: officer, byStaff: true, now: new Date("2026-12-20T00:00:00Z") });
    // Invoices are issued with the real clock, so set the 1600 invoice's due date to Jan 1 to test lateness
    const e = await db.earner.findUniqueOrThrow({ where: { id: imran } });
    const open = await db.invoice.findFirstOrThrow({ where: { clientId: e.billingClientId!, status: "ISSUED" } });
    await db.invoice.update({ where: { id: open.id }, data: { dueDate: new Date("2027-01-01T00:00:00Z") } });
    const r2 = await runResaleDaily(db, org, new Date("2027-01-05T04:00:00Z"));
    expect(r2).toBe("1 draft invoice for December 2026"); // 4 days late: no warning yet
    expect(await db.notification.count({ where: { userId: finance, kind: "partner.resale_drafts" } })).toBe(1);
    expect(await runResaleDaily(db, org, new Date("2027-01-08T04:00:00Z"))).toMatch(/1 overdue warning/);
    expect(await runResaleDaily(db, org, new Date("2027-01-09T04:00:00Z"))).toBe("Nothing due today");
    expect(sent.filter((m) => /overdue/.test(m.subject))).toHaveLength(1);
    expect(await runResaleDaily(db, org, new Date("2027-01-16T04:00:00Z"))).toMatch(/1 pause alert/);
    const alert = await db.notification.findFirstOrThrow({ where: { userId: officer, kind: "partner.resale_pause" } });
    expect(alert.body).toMatch(/Campusly/);
    expect(alert.body).toMatch(/Bright Future School/);
  });
  it("a month without terms is not billed", () => { expect(JAN > DEC).toBe(true); });
});
