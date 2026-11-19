// Answering task emails against hifi_one_test: private reply addresses, who may reply, quote stripping, notifications, retries.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { receiveInbound } from "./mailboxes";
import { commentSharedWithClient, taskAssigned, taskCommented, taskReplyReceived } from "./events";
import { REPLY_NOTE, receiveTaskReply, replyAddressFor, replyDomain, stripQuoted } from "./task-mail";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
const ENV = { RESEND_API_KEY: "re_test", RESEND_WEBHOOK_SECRET: "whsec_dGVzdA==" };
let saved: Record<string, string | undefined> = {};

let org: string, boss: string, ana: string, gone: string, outsider: string, clientUser: string, otherClientUser: string, proj: string, task: string, hidden: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaskReplyAddress","TaskComment","Notification","EmailMessage","MailMessage","MailThread","MailboxMember","Mailbox","Task","ProjectMember","Project","Client","User","Organization","AuditLog" CASCADE');
  org = (await db.organization.create({ data: { name: "Reply Org" } })).id;
  const client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  const other = (await db.client.create({ data: { organizationId: org, name: "Other", currency: "USD" } })).id;
  const mk = (name: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { organizationId: org, name, email: `${name}@people.test`, passwordHash: "x", userType: "EMPLOYEE", ...extra } }).then((u) => u.id);
  boss = await mk("boss"); ana = await mk("ana"); gone = await mk("gone"); outsider = await mk("outsider");
  clientUser = await mk("omar", { userType: "CLIENT", clientId: client });
  otherClientUser = await mk("zed", { userType: "CLIENT", clientId: other });
  proj = (await db.project.create({ data: { organizationId: org, number: "R-1", name: "Site", managerId: boss, clientId: client, members: { create: [{ userId: boss }, { userId: ana }, { userId: gone }] } } })).id;
  task = (await db.task.create({ data: { projectId: proj, title: "Design", clientVisible: true, assigneeId: ana, createdById: boss } })).id;
  hidden = (await db.task.create({ data: { projectId: proj, title: "Internal", clientVisible: false } })).id;
  await db.mailbox.create({ data: { organizationId: org, address: "noreply@hifimarketing.co", displayName: "Hifi", kind: "SYSTEM", purpose: "NOREPLY" } });
  await db.user.update({ where: { id: gone }, data: { active: false } });
});
beforeEach(() => {
  saved = { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET };
  Object.assign(process.env, ENV);
  setTransportForTests({ async send(m) { sent.push(m); return { messageId: "x" }; }, async verify() {} });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setTransportForTests(null); sent.length = 0;
});
afterAll(async () => { await db.$disconnect(); });

const addressOf = async (userId: string, taskId = task) => (await replyAddressFor(db, { organizationId: org, taskId, userId }))!;
let n = 0;
const reply = (to: string, from: string, text: string) => receiveTaskReply(db, { emailId: `em_${++n}`, recipients: [to], from, text });

describe("stripQuoted", () => {
  it("keeps only the new text above the quoted message, signature or Outlook header", () => {
    expect(stripQuoted("Looks good, go ahead.\n\nOn Mon, 17 Nov 2026 at 10:00, Hifi <noreply@hifimarketing.co> wrote:\n> You have a new task")).toBe("Looks good, go ahead.");
    expect(stripQuoted("Done.\r\n\r\nOn Mon, 17 Nov 2026 at 10:00 Hifi\r\n<noreply@hifimarketing.co> wrote:\r\n> old")).toBe("Done.");
    expect(stripQuoted("Yes\n________________________________\nFrom: Hifi\nSent: Monday")).toBe("Yes");
    expect(stripQuoted("Thanks\n-- \nOmar\nCEO")).toBe("Thanks");
    expect(stripQuoted("Point one\n> quoted\nPoint two")).toBe("Point one\nPoint two");
    expect(stripQuoted("> all quoted")).toBe("");
  });
});

describe("reply addresses", () => {
  it("are only offered when receiving is configured and a company mailbox gives the domain, and stay the same per person and task", async () => {
    expect(await replyDomain(db, org, {})).toBeNull();
    expect(await replyDomain(db, org, ENV)).toBe("hifimarketing.co");
    const a = await addressOf(ana);
    expect(a).toMatch(/^reply-[a-z0-9]{24}@hifimarketing\.co$/);
    expect(await addressOf(ana)).toBe(a);
    expect(await addressOf(boss)).not.toBe(a);
    expect(await replyAddressFor(db, { organizationId: org, taskId: task, userId: ana, env: {} })).toBeNull();
  });
});

describe("receiveTaskReply", () => {
  it("adds a staff reply as an internal comment by that person, without the quoted email, once per email", async () => {
    const to = await addressOf(ana);
    const r = await receiveTaskReply(db, { emailId: "em_once", recipients: [to.toUpperCase()], from: "ANA@people.test", text: "On it.\n\nOn Tue, Hifi wrote:\n> New task" });
    expect(r).toMatchObject({ added: true, userId: ana, fromClient: false });
    const c = await db.taskComment.findFirstOrThrow({ where: { sourceEmailId: "em_once" } });
    expect(c).toMatchObject({ body: "On it.", authorId: ana, internal: true, taskId: task });
    expect(await receiveTaskReply(db, { emailId: "em_once", recipients: [to], from: "ana@people.test", text: "On it." })).toEqual({ added: false, reason: "already added" });
    expect(await db.auditLog.count({ where: { entityId: task, action: "task.comment" } })).toBe(1);
  });

  it("adds a client reply as a shared comment when the task is shared with their company", async () => {
    const r = await reply(await addressOf(clientUser), "omar@people.test", "Approved, thanks!");
    expect(r).toMatchObject({ added: true, fromClient: true });
    expect(await db.taskComment.findFirstOrThrow({ where: { id: (r as { commentId: string }).commentId } })).toMatchObject({ internal: false, authorId: clientUser });
  });

  it("refuses a sender who is not the address's owner, unknown addresses, empty replies, people who left, and tasks no longer shared", async () => {
    const to = await addressOf(ana);
    expect(await reply(to, "boss@people.test", "Hi")).toMatchObject({ added: false, reason: expect.stringContaining("sender does not match") });
    expect(await reply("reply-aaaaaaaaaaaaaaaaaaaaaaaa@hifimarketing.co", "ana@people.test", "Hi")).toMatchObject({ added: false, reason: "unknown reply address" });
    expect(await reply("billing@hifimarketing.co", "ana@people.test", "Hi")).toMatchObject({ added: false, reason: "not a reply address" });
    expect(await reply(to, "ana@people.test", "> only quote")).toMatchObject({ added: false, reason: "empty reply" });
    expect(await reply(await addressOf(gone), "gone@people.test", "Hi")).toMatchObject({ added: false });
    expect(await reply(await addressOf(outsider), "outsider@people.test", "Hi")).toMatchObject({ added: false, reason: "no longer on the project team" });
    expect(await reply(await addressOf(clientUser, hidden), "omar@people.test", "Hi")).toMatchObject({ added: false, reason: "task not shared with this client" });
    expect(await reply(await addressOf(otherClientUser), "zed@people.test", "Hi")).toMatchObject({ added: false, reason: "task not shared with this client" });
  });
});

describe("task emails carry the reply address", () => {
  it("sets Reply-To and the reply note on task assigned, mention and shared-comment emails", async () => {
    await taskAssigned(db, { organizationId: org, taskId: task, toUserId: ana, byUserId: boss });
    const assigned = sent.find((m) => m.to === "ana@people.test")!;
    expect(assigned.replyTo).toBe(await addressOf(ana));
    expect(assigned.text).toContain(REPLY_NOTE);

    sent.length = 0;
    const c = await db.taskComment.create({ data: { taskId: task, authorId: boss, body: "@ana please check" } });
    await taskCommented(db, { organizationId: org, taskId: task, commentId: c.id, authorId: boss, body: c.body });
    expect(sent.map((m) => [m.to, m.replyTo])).toEqual([["ana@people.test", await addressOf(ana)]]);
    expect(sent[0].subject).toBe("boss mentioned you on Design");

    sent.length = 0;
    const shared = await db.taskComment.create({ data: { taskId: task, authorId: boss, body: "Here is the draft.", internal: false } });
    await commentSharedWithClient(db, { organizationId: org, taskId: task, commentId: shared.id, authorId: boss });
    expect(sent.map((m) => [m.to, m.replyTo])).toEqual([["omar@people.test", await addressOf(clientUser)]]);
    expect(sent[0].text).toContain("Here is the draft.");
  });

  it("leaves Reply-To off and says nothing about replying while receiving is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const t2 = (await db.task.create({ data: { projectId: proj, title: "Copy" } })).id;
    await taskAssigned(db, { organizationId: org, taskId: t2, toUserId: ana, byUserId: boss });
    expect(sent[0].replyTo).toBeUndefined();
    expect(sent[0].text).not.toContain(REPLY_NOTE);
  });
});

describe("inbound webhook to a reply address", () => {
  it("adds the comment and notifies the team like a comment written on screen", async () => {
    const to = await addressOf(clientUser);
    const fetch = async () => ({ id: "em_hook", from: "Omar <omar@people.test>", to: [to], subject: "Re: New message on Design", text: "Please make the logo bigger.\n\nOn Mon, Hifi wrote:\n> Here is the draft." });
    const r = await receiveInbound(db, { type: "email.received", data: { email_id: "em_hook" } }, fetch, (m) => taskReplyReceived(db, m));
    expect(r).toMatchObject({ stored: 0, reply: { added: true, fromClient: true } });
    expect((await db.taskComment.findFirstOrThrow({ where: { sourceEmailId: "em_hook" } })).body).toBe("Please make the logo bigger.");
    const told = await db.notification.findMany({ where: { kind: "task.client_comment" }, select: { userId: true } });
    expect(told.map((x) => x.userId).sort()).toEqual([ana, boss].sort());
    const again = await receiveInbound(db, { type: "email.received", data: { email_id: "em_hook" } }, fetch, (m) => taskReplyReceived(db, m));
    expect(again).toMatchObject({ reply: { added: false, reason: "already added" } });
  });

  it("emails mentions written in a staff reply", async () => {
    const to = await addressOf(ana);
    const r = await taskReplyReceived(db, { emailId: "em_mention", recipients: [to], from: "ana@people.test", text: "@boss can you approve?" });
    expect(r).toMatchObject({ added: true });
    expect(sent.map((m) => m.to)).toEqual(["boss@people.test"]);
  });
});
