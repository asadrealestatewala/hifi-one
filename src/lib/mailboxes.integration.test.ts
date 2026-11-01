import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MailError, sendEmail, setTransportForTests, type Outgoing } from "./mailer";
import { baseSubject, parseAddress } from "./mail-store";
import {
  USER_HOURLY_LIMIT, addMember, cleanLocalPart, createMailbox, mailboxFor, markThread, receiveInbound, removeMember, sendFromMailbox,
  setupStandardMailboxes, threadFor, updateMailbox, verifyWebhook, type ReceivedEmail,
} from "./mailboxes";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string;
let sara: { id: string; organizationId: string; name: string }, omar: typeof sara, admin: typeof sara, outsider: typeof sara;
const sent: Outgoing[] = [];
const D = "hifimarketing.co";

let seq = 0;
const ok = () => setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} });
const person = async (organizationId: string, name: string, email: string, active = true) => {
  const u = await db.user.create({ data: { organizationId, name, email, passwordHash: "x", active } });
  return { id: u.id, organizationId, name };
};

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "MailMessage","MailThread","MailboxMember","Mailbox","Notification","EmailMessage","Client","Contact","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Mail Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  sara = await person(org, "Sara Khan", "sara@personal.test");
  omar = await person(org, "Omar Ali", "omar@personal.test");
  admin = await person(org, "Admin", "admin@personal.test");
  outsider = await person(other, "Outsider", "out@other.test");
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", email: "ap@acme.test", currency: "USD" } })).id;
});
afterEach(() => { setTransportForTests(null); sent.length = 0; });
afterAll(async () => { await db.$disconnect(); });

describe("creating mailboxes", () => {
  it("creates a personal mailbox for an active employee and makes them its only member", async () => {
    const mb = await createMailbox(db, { organizationId: org, actorId: admin.id, kind: "PERSONAL", localPart: "Sara.Khan", displayName: "Sara Khan", ownerId: sara.id, domain: D });
    expect(mb.address).toBe("sara.khan@hifimarketing.co");
    const members = await db.mailboxMember.findMany({ where: { mailboxId: mb.id } });
    expect(members.map((m) => [m.userId, m.canSend])).toEqual([[sara.id, true]]);
  });

  it("lets one employee have more than one mailbox, but never the same address twice", async () => {
    await createMailbox(db, { organizationId: org, actorId: admin.id, kind: "PERSONAL", localPart: "sara", displayName: "Sara", ownerId: sara.id, domain: D });
    await expect(createMailbox(db, { organizationId: org, actorId: admin.id, kind: "PERSONAL", localPart: "sara", displayName: "Sara", ownerId: omar.id, domain: D })).rejects.toThrow(/already exists/);
    expect(await db.mailbox.count({ where: { ownerId: sara.id } })).toBe(2);
  });

  it("refuses bad addresses, employees from another organization and inactive staff", async () => {
    for (const bad of ["", "a b", "-x", "x.", "a..b", "ünï", "a+b"]) expect(() => cleanLocalPart(bad), bad).toThrow(MailError);
    expect(cleanLocalPart("Sara.Khan@elsewhere.test")).toBe("sara.khan");
    await expect(createMailbox(db, { organizationId: org, actorId: admin.id, kind: "PERSONAL", localPart: "out", displayName: "x", ownerId: outsider.id, domain: D })).rejects.toThrow(/not found/);
    const gone = await person(org, "Gone", "gone@personal.test", false);
    await expect(createMailbox(db, { organizationId: org, actorId: admin.id, kind: "PERSONAL", localPart: "gone", displayName: "x", ownerId: gone.id, domain: D })).rejects.toThrow(/inactive/);
  });

  it("sets up noreply, billing, hr, onboarding and finance once, and again creates nothing", async () => {
    const made = await setupStandardMailboxes(db, { organizationId: org, actorId: admin.id, companyName: "Hifi Marketing" });
    expect(made.map((a) => a.split("@")[0])).toEqual(["noreply", "billing", "hr", "onboarding", "finance"]);
    expect(await setupStandardMailboxes(db, { organizationId: org, actorId: admin.id, companyName: "Hifi Marketing" })).toEqual([]);
    const billing = await db.mailbox.findFirstOrThrow({ where: { organizationId: org, purpose: "BILLING" } });
    expect(billing.displayName).toBe("Hifi Marketing Billing");
    expect(billing.kind).toBe("SYSTEM");
  });

  it("will not remove the owner of a personal mailbox", async () => {
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara.khan@${D}` } });
    await expect(removeMember(db, { organizationId: org, mailboxId: mb.id, userId: sara.id })).rejects.toThrow(/owner/);
  });
});

describe("who can use a mailbox", () => {
  it("only members see a mailbox; an administrator who is not a member does not", async () => {
    const hr = await db.mailbox.findFirstOrThrow({ where: { organizationId: org, purpose: "HR" } });
    expect(await mailboxFor(db, admin, hr.id)).toBeNull();
    expect(await mailboxFor(db, outsider, hr.id)).toBeNull();
    await addMember(db, { organizationId: org, mailboxId: hr.id, userId: omar.id, canSend: false });
    expect(await mailboxFor(db, omar, hr.id)).not.toBeNull();
    expect(await mailboxFor(db, omar, hr.id, { send: true })).toBeNull();
  });

  it("a read-only member cannot send and a non-member cannot send", async () => {
    ok();
    const hr = await db.mailbox.findFirstOrThrow({ where: { organizationId: org, purpose: "HR" } });
    await expect(sendFromMailbox(db, { user: omar, mailboxId: hr.id, to: "x@y.test", subject: "Hi", text: "Hi" })).rejects.toThrow(/cannot send/);
    await expect(sendFromMailbox(db, { user: admin, mailboxId: hr.id, to: "x@y.test", subject: "Hi", text: "Hi" })).rejects.toThrow(/cannot send/);
    expect(sent).toHaveLength(0);
  });

  it("a switched-off mailbox disappears for its members", async () => {
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara@${D}` } });
    await updateMailbox(db, { organizationId: org, mailboxId: mb.id, active: false });
    expect(await mailboxFor(db, sara, mb.id)).toBeNull();
    await updateMailbox(db, { organizationId: org, mailboxId: mb.id, active: true });
  });
});

describe("sending from a mailbox", () => {
  it("sends from the mailbox address with its signature, links the client and records the thread", async () => {
    ok();
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara.khan@${D}` } });
    await updateMailbox(db, { organizationId: org, mailboxId: mb.id, signature: "Sara Khan\nHifi Marketing" });
    const m = await sendFromMailbox(db, { user: sara, mailboxId: mb.id, to: "AP@acme.test", cc: "boss@acme.test, ap@acme.test", subject: "Your campaign\r\n", text: "Hello there" });
    expect(m.status).toBe("SENT");
    expect(sent[0].from).toBe(`Sara Khan <sara.khan@${D}>`);
    expect(sent[0].to).toBe("ap@acme.test");
    expect(sent[0].cc).toEqual(["boss@acme.test"]);
    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    expect(sent[0].text).toContain("-- \nSara Khan");
    expect(sent[0].messageId).toMatch(/^<.+@hifimarketing\.co>$/);
    const t = await db.mailThread.findUniqueOrThrow({ where: { id: m.threadId } });
    expect(t.clientId).toBe(client);
    expect(t.counterpart).toBe("ap@acme.test");
  });

  it("keeps the message and says so when email is not connected", async () => {
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara.khan@${D}` } });
    const m = await sendFromMailbox(db, { user: sara, mailboxId: mb.id, to: "new@person.test", subject: "Hello", text: "Hi" });
    expect(m.status).toBe("NOT_CONFIGURED");
  });

  it("refuses more than the hourly limit per person", async () => {
    ok();
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara@${D}` } });
    const t = await db.mailThread.create({ data: { organizationId: org, mailboxId: mb.id, subject: "bulk", counterpart: "x@y.test" } });
    await db.mailMessage.createMany({ data: Array.from({ length: USER_HOURLY_LIMIT }, () => ({ organizationId: org, mailboxId: mb.id, threadId: t.id, direction: "OUT", fromAddress: mb.address, toAddresses: ["x@y.test"], subject: "s", text: "b", status: "SENT", sentById: sara.id })) });
    await expect(sendFromMailbox(db, { user: sara, mailboxId: mb.id, to: "x@y.test", subject: "One more", text: "Hi" })).rejects.toThrow(/limit/);
    await db.mailThread.delete({ where: { id: t.id } });
  });
});

describe("system emails use the shared addresses", () => {
  it("sends invoices from billing@ and keeps a copy in its Sent folder", async () => {
    ok();
    const m = await sendEmail(db, { organizationId: org, to: "ap@acme.test", subject: "Invoice INV-1", text: "Please pay", relatedType: "INVOICE", relatedId: "inv1" });
    expect(m.status).toBe("SENT");
    expect(sent[0].from).toBe(`Hifi Marketing Billing <billing@${D}>`);
    const copy = await db.mailMessage.findFirstOrThrow({ where: { relatedType: "INVOICE", relatedId: "inv1" }, include: { mailbox: true } });
    expect(copy.mailbox.purpose).toBe("BILLING");
    expect(copy.messageId).toBe(sent[0].messageId);
  });

  it("falls back to the default sender when no mailbox has that purpose", async () => {
    ok();
    await sendEmail(db, { organizationId: other, to: "a@b.test", subject: "Invoice", text: "x", relatedType: "INVOICE" });
    expect(sent[0].from).toBe("test@example.invalid");
  });
});

describe("receiving", () => {
  const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const sign = (id: string, ts: string, body: string) => "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

  it("accepts only a correctly signed, recent webhook", () => {
    const body = '{"type":"email.received"}';
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: `v1,bogus ${sign("msg_1", ts, body)}` }, body)).toBe(true);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body + " ")).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_2", timestamp: ts, signature: sign("msg_1", ts, body) }, body)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, body)).toBe(false);
    expect(verifyWebhook(secret, { id: null, timestamp: ts, signature: null }, body)).toBe(false);
  });

  const fetcher = (e: Partial<ReceivedEmail>) => async (id: string): Promise<ReceivedEmail> => ({ id, from: "x@y.test", to: [], ...e });

  it("files a client's reply into the conversation it answers and notifies the mailbox members", async () => {
    const original = await db.mailMessage.findFirstOrThrow({ where: { relatedType: "INVOICE", relatedId: "inv1" } });
    const billing = await db.mailbox.findFirstOrThrow({ where: { purpose: "BILLING", organizationId: org } });
    await addMember(db, { organizationId: org, mailboxId: billing.id, userId: omar.id, canSend: true });
    const f = fetcher({ from: "Acme AP <ap@acme.test>", to: [`billing@${D}`], subject: "RE: Invoice INV-1", text: "Paid today.", message_id: "<reply-1@acme.test>", headers: { "In-Reply-To": original.messageId! } });
    expect(await receiveInbound(db, { type: "email.received", data: { email_id: "em_1" } }, f)).toEqual({ stored: 1 });
    const msg = await db.mailMessage.findFirstOrThrow({ where: { providerId: `in:em_1:${billing.id}` } });
    expect(msg.threadId).toBe(original.threadId);
    expect(msg.fromName).toBe("Acme AP");
    const t = await db.mailThread.findUniqueOrThrow({ where: { id: msg.threadId } });
    expect(t.unread).toBe(1);
    expect(t.clientId).toBe(client);
    expect(await db.notification.count({ where: { userId: omar.id, kind: "mail" } })).toBe(1);
    // Resend retries the same webhook: nothing new is stored or notified
    expect(await receiveInbound(db, { type: "email.received", data: { email_id: "em_1" } }, f)).toEqual({ stored: 0 });
    expect(await db.mailMessage.count({ where: { threadId: msg.threadId, direction: "IN" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: omar.id, kind: "mail" } })).toBe(1);
  });

  it("threads a reply without headers by subject, starts new conversations otherwise, and recognises staff", async () => {
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `sara.khan@${D}` } });
    await receiveInbound(db, { type: "email.received", data: { email_id: "em_2" } }, fetcher({ from: "ap@acme.test", to: [`Sara <sara.khan@${D}>`], subject: "Re: Your campaign", html: "<p>Looks <b>great</b></p>" }));
    const first = await db.mailThread.findMany({ where: { mailboxId: mb.id, counterpart: "ap@acme.test" } });
    expect(first).toHaveLength(1);
    expect(await db.mailMessage.findFirstOrThrow({ where: { providerId: `in:em_2:${mb.id}` } })).toMatchObject({ text: "Looks great", threadId: first[0].id });
    await receiveInbound(db, { type: "email.received", data: { email_id: "em_3" } }, fetcher({ from: "omar@personal.test", to: [`sara.khan@${D}`], subject: "Leave next week" }));
    const staffThread = await db.mailThread.findFirstOrThrow({ where: { mailboxId: mb.id, counterpart: "omar@personal.test" } });
    expect(staffThread.employeeId).toBe(omar.id);
  });

  it("ignores mail for addresses nobody has, and switched-off mailboxes", async () => {
    expect((await receiveInbound(db, { type: "email.received", data: { email_id: "em_4" } }, fetcher({ to: [`nobody@${D}`] }))).stored).toBe(0);
    const mb = await db.mailbox.findFirstOrThrow({ where: { address: `finance@${D}` } });
    await updateMailbox(db, { organizationId: org, mailboxId: mb.id, active: false });
    expect((await receiveInbound(db, { type: "email.received", data: { email_id: "em_5" } }, fetcher({ to: [`finance@${D}`] }))).stored).toBe(0);
    expect((await receiveInbound(db, { type: "email.sent", data: { email_id: "em_6" } }, fetcher({}))).stored).toBe(0);
  });

  it("only members can open or archive a conversation", async () => {
    const t = await db.mailThread.findFirstOrThrow({ where: { mailbox: { address: `sara.khan@${D}` } } });
    expect(await threadFor(db, omar, t.id)).toBeNull();
    expect(await threadFor(db, outsider, t.id)).toBeNull();
    await expect(markThread(db, omar, t.id, "archive")).rejects.toThrow(/not found/);
    expect((await markThread(db, sara, t.id, "archive")).status).toBe("ARCHIVED");
  });
});

describe("helpers", () => {
  it("parses addresses and strips reply prefixes", () => {
    expect(parseAddress('"Acme AP" <AP@Acme.test>')).toEqual({ address: "ap@acme.test", name: "Acme AP" });
    expect(parseAddress("ap@acme.test")).toEqual({ address: "ap@acme.test", name: null });
    expect(baseSubject("Re: FWD: re[2]: Invoice 12")).toBe("invoice 12");
  });
});
