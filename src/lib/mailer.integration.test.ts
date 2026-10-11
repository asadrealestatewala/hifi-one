import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice } from "./accounting";
import { emailInvoice, emailQuote, emailStatement } from "./email-docs";
import { HOURLY_LIMIT, MailError, cleanAddress, mailConfig, sendEmail, setTransportForTests, verifyMail, type Outgoing } from "./mailer";
import { createQuote, sendQuote } from "./sales";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, client: string;
const sent: Outgoing[] = [];

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "EmailMessage","QuoteLine","Quote","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","Account","Client","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Mail Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Mail Org Ltd" } });
  await db.account.create({ data: { organizationId: org, code: "1200", name: "AR", type: "ASSET", systemKey: "AR" } });
  await db.account.create({ data: { organizationId: org, code: "4000", name: "Revenue", type: "REVENUE", systemKey: "REVENUE_SERVICE" } });
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", email: "ap@acme.test", currency: "USD" } })).id;
});
afterEach(() => { setTransportForTests(null); sent.length = 0; });
afterAll(async () => { await db.$disconnect(); });

const ok = () => setTransportForTests({ async send(m) { sent.push(m); return { messageId: "<id-1@test>" }; }, async verify() {} });

describe("configuration", () => {
  it("is only configured with a host and a sender", () => {
    expect(mailConfig({}).configured).toBe(false);
    expect(mailConfig({ SMTP_HOST: "smtp.x.test" }).configured).toBe(false);
    expect(mailConfig({ SMTP_HOST: "smtp.x.test", MAIL_FROM: "a@x.test" }).configured).toBe(true);
    expect(mailConfig({ SMTP_HOST: "h", MAIL_FROM: "a@x.test", SMTP_PORT: "465" }).secure).toBe(true);
  });
  it("reports clearly when nothing is connected, and when a server rejects the connection", async () => {
    expect((await verifyMail()).ok).toBe(false);
    setTransportForTests({ async send() { return {}; }, async verify() { throw new Error("535 bad login"); } });
    const r = await verifyMail();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("535 bad login");
  });
});

describe("addresses", () => {
  it("accepts one clean address and refuses anything that could add recipients or headers", () => {
    expect(cleanAddress(" ap@acme.test ")).toBe("ap@acme.test");
    for (const bad of ["", "nope", "a@b", "a@b.c", "a@b.test, c@d.test", "a@b.test\r\nBcc: x@y.test", "a b@c.test", "<a@b.test>", "a@b.test;c@d.test"]) {
      expect(() => cleanAddress(bad), bad).toThrow(MailError);
    }
  });
});

describe("sending", () => {
  it("logs NOT_CONFIGURED and sends nothing when there is no mail account", async () => {
    const m = await sendEmail(db, { organizationId: org, to: "ap@acme.test", subject: "Hello", text: "Hi" });
    expect(m.status).toBe("NOT_CONFIGURED");
    expect(m.sentAt).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("logs SENT only after the server accepts, and FAILED with the reason otherwise", async () => {
    ok();
    const good = await sendEmail(db, { organizationId: org, to: "ap@acme.test", subject: "Line one\r\nBcc: evil@x.test", text: "Hi" });
    expect(good.status).toBe("SENT");
    expect(good.providerMessageId).toBe("<id-1@test>");
    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    setTransportForTests({ async send() { throw new Error("550 mailbox unavailable"); }, async verify() {} });
    const bad = await sendEmail(db, { organizationId: org, to: "ap@acme.test", subject: "Hello", text: "Hi" });
    expect(bad.status).toBe("FAILED");
    expect(bad.error).toContain("550");
    expect(bad.sentAt).toBeNull();
  });

  it("limits how many emails one organization can send per hour", async () => {
    await db.emailMessage.deleteMany();
    ok();
    await db.emailMessage.createMany({ data: Array.from({ length: HOURLY_LIMIT }, () => ({ organizationId: org, toEmail: "x@y.test", subject: "s", body: "b", status: "SENT" })) });
    await expect(sendEmail(db, { organizationId: org, to: "ap@acme.test", subject: "One too many", text: "Hi" })).rejects.toThrow(/limit/);
    expect(sent).toHaveLength(0);
    await db.emailMessage.deleteMany();
  });
});

describe("documents by email", () => {
  it("emails an issued invoice with its PDF attached, and refuses drafts", async () => {
    ok();
    const draft = await createDraftInvoice(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: "u", lines: [{ description: "Work", quantity: "1", unitPrice: "250" }] });
    await expect(emailInvoice(db, { organizationId: org, invoiceId: draft.id, to: "ap@acme.test", actorId: "u" })).rejects.toThrow(/issued/);
    const inv = await issueInvoice(db, { organizationId: org, invoiceId: draft.id, actorId: "u" });
    const m = await emailInvoice(db, { organizationId: org, invoiceId: inv.id, to: "ap@acme.test", actorId: "u" });
    expect(m.status).toBe("SENT");
    expect(m.relatedType).toBe("INVOICE");
    const msg = sent.at(-1)!;
    expect(msg.subject).toContain(inv.number!);
    expect(msg.attachments?.[0].filename).toBe(`invoice-${inv.number}.pdf`);
    expect(msg.attachments?.[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(msg.text).toContain("$250.00");
  });

  it("will not email another organization's invoice", async () => {
    ok();
    const inv = await db.invoice.findFirstOrThrow({ where: { organizationId: org } });
    const other = (await db.organization.create({ data: { name: "Other" } })).id;
    await expect(emailInvoice(db, { organizationId: other, invoiceId: inv.id, to: "ap@acme.test", actorId: "u" })).rejects.toThrow(/not found/);
    expect(sent).toHaveLength(0);
  });

  it("emails a sent quotation and a statement, but not a draft quotation", async () => {
    ok();
    const q = await createQuote(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: "u", lines: [{ description: "Design", quantity: "1", unitPrice: "900" }] });
    await expect(emailQuote(db, { organizationId: org, quoteId: q.id, to: "ap@acme.test", actorId: "u" })).rejects.toThrow(/Mark the quotation/);
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    expect((await emailQuote(db, { organizationId: org, quoteId: q.id, to: "ap@acme.test", actorId: "u" })).status).toBe("SENT");
    expect((await emailStatement(db, { organizationId: org, clientId: client, to: "ap@acme.test", actorId: "u" })).status).toBe("SENT");
    expect(sent.map((s) => s.attachments?.[0].filename)).toEqual([`quotation-${q.number}.pdf`, "account-statement.pdf"]);
  });
});
