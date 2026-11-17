// Reseller counts filled from the Solutions' own reports (Live Solutions), against hifi_one_test. A filled count still waits for
// Hifi to confirm; a partner count lower than the report is visible to staff; confirmed and billed counts are never touched.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { addSchool, confirmCounts, enterCount, fillCountsFromSolutions, runResaleDaily, setResaleTerm } from "./partner-resale";
import { addPartner, ensurePartnerDefaults } from "./partner-stack";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
let seq = 0;
let org: string, officer: string, imran: string, imranUser: string, campusly: string;
let s1: string, s2: string, s3: string, c1: string, c2: string;
const NOW = new Date("2026-11-17T05:00:00Z");
const NOV = "2026-11", DEC = "2026-12";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "SolutionWorkspace","PartnerPaymentNotice","ResaleCount","ResaleSchool","PartnerResaleTerm","PartnerPayoutAccount","PartnerIdentity","StoredFile","InvoiceLine","Invoice","Client","NumberSequence","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerInquiry","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","UserRole","Role","JobRun","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  officer = (await db.user.create({ data: { organizationId: org, name: "Pat", email: "pat@hifi.test", passwordHash: "x" } })).id;
  await ensurePartnerDefaults(db, org);
  const a = await addPartner(db, { organizationId: org, actorId: officer, name: "Afaq Ur Rehman", email: "afaq@schools.test", phone: "03001112223", city: "Lahore", country: "Pakistan", typeKey: "RESELLER", ratePercent: "30", durationMonths: "lifetime", leadSharing: false, solutionCodes: ["CAMPUSLY"], trainingOptional: false });
  imran = a.id; imranUser = a.userId!;
  await db.partnerIdentity.create({ data: { organizationId: org, earnerId: imran, legalName: "Afaq Ur Rehman", idType: "CNIC", idNumberEnc: "x", idLast4: "5671", address: "Lahore", status: "VERIFIED", submittedAt: NOW, reviewedAt: NOW } });
  await setResaleTerm(db, { organizationId: org, earnerId: imran, productCode: "CAMPUSLY", actorId: officer, now: NOW, input: { model: "RESALE", collection: "PARTNER_COLLECTS", unitName: "student", currency: "PKR", wholesalePrice: "20", resalePrice: "50", paymentTermsDays: "10", effectiveFrom: NOV } });
  const add = (name: string) => addSchool(db, { organizationId: org, earnerId: imran, actorId: officer, byStaff: true, input: { productCode: "CAMPUSLY", name, startMonth: NOV }, now: NOW });
  const x1 = await add("Bright Future School"); const x2 = await add("Green Valley School"); const x3 = await add("Unlinked School");
  s1 = x1.id; s2 = x2.id; s3 = x3.id; c1 = x1.clientId; c2 = x2.clientId;
  campusly = x1.productId;
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

const report = (clientId: string | null, externalId: string, units: number | null, reportedAt: Date) =>
  db.solutionWorkspace.upsert({
    where: { productId_externalId: { productId: campusly, externalId } },
    create: { organizationId: org, productId: campusly, externalId, name: externalId, clientId, status: "LIVE", units, unitLabel: "students", reportedAt },
    update: { units, reportedAt, clientId },
  });

describe("filling counts from Live Solutions", () => {
  it("fills a missing count from a linked, recent report and leaves it waiting for confirmation", async () => {
    await report(c1, "bright", 412, new Date(NOW.getTime() - 3600000));
    await report(c2, "green", 300, new Date(NOW.getTime() - 4 * 86400000)); // too old
    await report(null, "not-linked", 999, NOW);
    await expect(fillCountsFromSolutions(db, { organizationId: org, month: DEC, now: NOW })).rejects.toThrow(/this month or an earlier/);
    expect(await fillCountsFromSolutions(db, { organizationId: org, month: NOV, now: NOW })).toEqual({ filled: 1, checked: 0 });
    const c = await db.resaleCount.findUniqueOrThrow({ where: { schoolId_month: { schoolId: s1, month: NOV } } });
    expect(c).toMatchObject({ units: 412, source: "SOLUTION", reportedUnits: 412, enteredById: null, confirmedAt: null });
    expect(await db.resaleCount.count({ where: { schoolId: { in: [s2, s3] } } })).toBe(0);
    expect(await fillCountsFromSolutions(db, { organizationId: org, month: NOV, now: NOW })).toEqual({ filled: 0, checked: 1 }); // runs twice safely
  });
  it("a partner can still correct a filled count; the report stays beside it for staff", async () => {
    const r = await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s1, month: NOV, units: "380", actorId: imranUser, byStaff: false, now: NOW });
    expect(r.after).toMatchObject({ units: 380, source: "PARTNER", reportedUnits: 412, confirmedAt: null });
  });
  it("never changes a confirmed count", async () => {
    await report(c2, "green", 305, NOW);
    await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s2, month: NOV, units: "290", actorId: officer, byStaff: true, now: NOW });
    expect((await db.resaleCount.findUniqueOrThrow({ where: { schoolId_month: { schoolId: s2, month: NOV } } })).source).toBe("STAFF");
    await fillCountsFromSolutions(db, { organizationId: org, month: NOV, now: NOW });
    expect(await db.resaleCount.findUniqueOrThrow({ where: { schoolId_month: { schoolId: s2, month: NOV } } })).toMatchObject({ units: 290, reportedUnits: null });
    const ids = (await db.resaleCount.findMany({ where: { month: NOV } })).map((x) => x.id);
    await confirmCounts(db, { organizationId: org, countIds: ids, actorId: officer });
  });
  it("on the 1st the daily job fills last month's counts first and only reminds a partner who still has a school without one", async () => {
    const DEC1 = new Date("2026-12-01T04:00:00Z");
    await report(c1, "bright", 415, new Date(DEC1.getTime() - 1800000));
    await report(c2, "green", 310, new Date(DEC1.getTime() - 1800000));
    // November was already filled and confirmed above; only the unlinked school is still missing
    expect(await runResaleDaily(db, org, DEC1)).toBe("1 count reminder");
    expect(await runResaleDaily(db, org, new Date("2026-12-01T06:00:00Z"))).toBe("0 count reminders"); // once per partner and month
    expect(sent.filter((m) => m.to === "afaq@schools.test" && /student counts for November 2026/.test(m.subject))).toHaveLength(1);
    await enterCount(db, { organizationId: org, earnerId: imran, schoolId: s3, month: NOV, units: "0", actorId: officer, byStaff: true, now: DEC1 });
    // Next month: everything linked fills, the unlinked school is removed, so no reminder at all
    await db.resaleSchool.update({ where: { id: s3 }, data: { endedAt: new Date("2026-11-20T00:00:00Z"), endedById: officer } });
    const JAN1 = new Date("2027-01-01T04:00:00Z");
    await report(c1, "bright", 420, JAN1); await report(c2, "green", 311, JAN1);
    expect(await runResaleDaily(db, org, JAN1)).toBe("2 counts filled from Live Solutions, 0 count reminders");
  });
});
