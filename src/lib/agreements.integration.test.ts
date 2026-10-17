import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AgreementError, createAgreement, declineAgreement, editAgreement, fillTemplate, intact, loadForSigning, placeholdersIn, saveTemplate, sendAgreement, signAgreement, voidAgreement } from "./agreements";
import { authorizeOwner, type FileActor } from "./file-access";
import { agreementPdf, DEFAULT_DOC_CONFIG } from "./pdf";
import { companyFrom, loadAgreementDoc } from "./pdf-data";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, staff: string, client: string, vendor: string, tpl: string;

// a real 1x1 PNG, repeated bytes are not needed: the check is signature + minimum length
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]).toString("base64");

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Agreement","DocumentTemplate","Notification","NumberSequence","CompanyProfile","StoredFile","Vendor","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Agr Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  staff = (await db.user.create({ data: { organizationId: org, email: "a@agr.test", name: "Amna", passwordHash: "x" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Podvet Clinic", email: "owner@podvet.test" } })).id;
  vendor = (await db.vendor.create({ data: { organizationId: org, code: "V-1", name: "Print Works" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Hifi Marketing and Technologies" } });
  tpl = (await saveTemplate(db, { organizationId: org, name: "Service agreement", kind: "CONTRACT", body: "This agreement is between {{company_name}} and {{client_name}} dated {{date}}. Fee: {{amount}}. The client agrees to pay on time." })).id;
});
afterAll(async () => { await db.$disconnect(); });

const draft = (over: Partial<Parameters<typeof createAgreement>[1]> = {}) => createAgreement(db, { organizationId: org, actorId: staff, title: "Service agreement", templateId: tpl, clientId: client, amount: "USD 1,200", ...over });

describe("templates", () => {
  it("finds and fills placeholders and reports what is missing", () => {
    expect(placeholdersIn("{{a_b}} and {{ date }} and {{a_b}}")).toEqual(["a_b", "date"]);
    expect(fillTemplate("Hi {{client_name}}, {{amount}}", { client_name: "X" })).toEqual({ text: "Hi X, {{amount}}", missing: ["amount"] });
  });
  it("rejects unknown placeholders, short text and duplicates", async () => {
    await expect(saveTemplate(db, { organizationId: org, name: "Bad", kind: "CONTRACT", body: "Dear {{nope}}, this text is long enough to pass." })).rejects.toThrow(/Unknown placeholder/);
    await expect(saveTemplate(db, { organizationId: org, name: "Short", kind: "CONTRACT", body: "tiny" })).rejects.toThrow(AgreementError);
    await expect(saveTemplate(db, { organizationId: org, name: "Service agreement", kind: "NDA", body: "A long enough body for the duplicate name check, truly." })).rejects.toThrow(/already exists/);
  });
});

describe("agreement lifecycle", () => {
  it("fills the template, numbers agreements in order and keeps other organizations out", async () => {
    const a = await draft();
    expect(a.number).toBe("AGR-0001");
    expect(a.body).toContain("Hifi Marketing and Technologies and Podvet Clinic");
    expect(a.body).toContain("USD 1,200");
    expect((await draft({ title: "Second" })).number).toBe("AGR-0002");
    await expect(draft({ clientId: client, vendorId: vendor })).rejects.toThrow(/not both/);
    await expect(createAgreement(db, { organizationId: other, actorId: staff, title: "Nope", templateId: tpl, clientId: client })).rejects.toThrow(/Unknown client|Template not found/);
  });

  it("refuses to send while placeholders are unfilled, then freezes the text", async () => {
    const a = await draft({ title: "Needs dates", amount: undefined });
    expect(a.body).toContain("{{amount}}");
    await expect(sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner" })).rejects.toThrow(/Fill in \{\{amount\}\}/);
    await editAgreement(db, { organizationId: org, id: a.id, title: a.title, body: a.body.replace("{{amount}}", "PKR 50,000") });
    const token = await sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner", signerEmail: "owner@podvet.test" });
    expect(token.length).toBeGreaterThan(30);
    const sent = await db.agreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.tokenHash).not.toBe(token); // only the hash is stored
    expect(intact(sent)).toBe(true);
    await expect(editAgreement(db, { organizationId: org, id: a.id, title: "x", body: "y".repeat(40) })).rejects.toThrow(/Only a draft/);
  });

  it("signs once, records the evidence and kills the link", async () => {
    const a = await draft({ title: "To sign" });
    const token = await sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner" });
    expect((await loadForSigning(db, token))?.title).toBe("To sign");
    await expect(signAgreement(db, { token, name: "Dr Owner", agree: false, ip: "1.2.3.4", userAgent: "UA" })).rejects.toThrow(/Tick the box/);
    await expect(signAgreement(db, { token, name: "Dr", agree: true, ip: null, userAgent: null })).rejects.toThrow(/full name/);
    await expect(signAgreement(db, { token, name: "Dr Owner", agree: true, signatureImage: "data:image/png;base64,AAAA", ip: null, userAgent: null })).rejects.toThrow(/not valid/);
    await expect(signAgreement(db, { token, name: "Dr Owner", agree: true, signatureImage: "javascript:alert(1)", ip: null, userAgent: null })).rejects.toThrow(/not valid/);
    const signed = await signAgreement(db, { token, name: "Dr Owner", agree: true, signatureImage: PNG, ip: "203.0.113.9", userAgent: "TestBrowser/1" });
    expect(signed).toMatchObject({ status: "SIGNED", signerName: "Dr Owner", signedIp: "203.0.113.9", tokenHash: null });
    expect(intact(signed)).toBe(true);
    expect(await loadForSigning(db, token)).toBeNull();
    await expect(signAgreement(db, { token, name: "Dr Owner", agree: true, ip: null, userAgent: null })).rejects.toThrow(/not valid any more/);
    expect(await db.notification.count({ where: { userId: staff, kind: "agreement.signed" } })).toBe(1);
  });

  it("two simultaneous signatures count once", async () => {
    const a = await draft({ title: "Race" });
    const token = await sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner" });
    const r = await Promise.allSettled([1, 2].map(() => signAgreement(db, { token, name: "Dr Owner", agree: true, ip: null, userAgent: null })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: staff, dedupeKey: `agreement-signed:${a.id}` } })).toBe(1);
  });

  it("expired, voided, tampered and invalid links cannot sign", async () => {
    const old = await draft({ title: "Old" });
    const t1 = await sendAgreement(db, { organizationId: org, id: old.id, signerName: "Dr Owner", now: new Date(Date.now() - 20 * 86_400_000) });
    expect(await loadForSigning(db, t1)).toBeNull();
    const v = await draft({ title: "Voided" });
    const t2 = await sendAgreement(db, { organizationId: org, id: v.id, signerName: "Dr Owner" });
    await expect(voidAgreement(db, { organizationId: other, id: v.id })).rejects.toThrow(/Only a draft or a sent/);
    await voidAgreement(db, { organizationId: org, id: v.id });
    await expect(signAgreement(db, { token: t2, name: "Dr Owner", agree: true, ip: null, userAgent: null })).rejects.toThrow(/not valid any more/);
    const tam = await draft({ title: "Tampered" });
    const t3 = await sendAgreement(db, { organizationId: org, id: tam.id, signerName: "Dr Owner" });
    await db.agreement.update({ where: { id: tam.id }, data: { body: "Changed behind the scenes, with plenty of words." } });
    await expect(signAgreement(db, { token: t3, name: "Dr Owner", agree: true, ip: null, userAgent: null })).rejects.toThrow(/changed after it was sent/);
    expect(await loadForSigning(db, "short")).toBeNull();
    expect(await loadForSigning(db, "x".repeat(43))).toBeNull();
  });

  it("a new link replaces the old one, and declining records a reason", async () => {
    const a = await draft({ title: "Resend" });
    const first = await sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner" });
    const second = await sendAgreement(db, { organizationId: org, id: a.id, signerName: "Dr Owner" });
    expect(await loadForSigning(db, first)).toBeNull();
    await expect(declineAgreement(db, { token: second, reason: "" })).rejects.toThrow(/briefly why/);
    await declineAgreement(db, { token: second, reason: "Fee too high" });
    const d = await db.agreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(d).toMatchObject({ status: "DECLINED", declineReason: "Fee too high", tokenHash: null });
    expect(await db.notification.count({ where: { userId: staff, kind: "agreement.declined" } })).toBe(1);
  });

  it("makes a PDF with the signature record, scoped to the organization", async () => {
    const signed = await db.agreement.findFirstOrThrow({ where: { status: "SIGNED" } });
    const doc = await loadAgreementDoc(db, { organizationId: org, agreementId: signed.id });
    expect(doc?.counterparty).toBe("Podvet Clinic");
    expect(await loadAgreementDoc(db, { organizationId: other, agreementId: signed.id })).toBeNull();
    const pdf = await agreementPdf({ ...doc!, company: companyFrom({ legalName: "Hifi" }), config: DEFAULT_DOC_CONFIG });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("vendor documents", () => {
  const actor = (over: Partial<FileActor>): FileActor => ({ id: "u", organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(), ...over });
  it("lets the vendor's own people and permitted staff in, and nobody else", async () => {
    expect(await authorizeOwner(db, actor({ userType: "VENDOR", vendorId: vendor }), "VENDOR_DOC", vendor, "upload")).toBe(true);
    expect(await authorizeOwner(db, actor({ userType: "VENDOR", vendorId: "someone-else" }), "VENDOR_DOC", vendor, "read")).toBe(false);
    expect(await authorizeOwner(db, actor({ permissions: new Set(["vendors.view"]) }), "VENDOR_DOC", vendor, "read")).toBe(true);
    expect(await authorizeOwner(db, actor({ permissions: new Set(["vendors.view"]) }), "VENDOR_DOC", vendor, "upload")).toBe(false);
    expect(await authorizeOwner(db, actor({ permissions: new Set(["vendors.manage"]) }), "VENDOR_DOC", vendor, "delete")).toBe(true);
    expect(await authorizeOwner(db, actor({ userType: "CLIENT", clientId: client }), "VENDOR_DOC", vendor, "read")).toBe(false);
    expect(await authorizeOwner(db, actor({ organizationId: other, permissions: new Set(["vendors.manage"]) }), "VENDOR_DOC", vendor, "read")).toBe(false);
  });
});
