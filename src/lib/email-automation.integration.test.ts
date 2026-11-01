import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import { resetSystemTemplate, saveFollowUpTemplate, saveSystemTemplate, sendTemplate } from "./email-template-store";
import { MAX_ATTEMPTS, decideOnboarding, onboardingByToken, resendCode, signInBlock, startOnboarding, verifyCode } from "./onboarding";
import { createSequence, enrollLead, readUnsubscribeToken, runFollowUps, setSequenceActive, setSteps, stopForReply, unsubscribe, unsubscribeToken } from "./followups";
import { leadAssigned, taskAssigned } from "./events";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
let seq = 0;
const ok = () => setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} });
const failing = () => setTransportForTests({ async send() { throw new Error("Resend 500: boom"); }, async verify() {} });
const DAY = 86_400_000;

let org: string, other: string, approver: string, hr: string, superAdmin: string, sales: string, stage1: string, stage2: string, won: string, lost: string;
const actor = (id: string, perms: string[] = ["onboarding.approve"], isSuperAdmin = false) => ({ id, isSuperAdmin, permissions: new Set(perms) });
const codeIn = (m: Outgoing) => /verification code: (\d{6})/.exec(m.text)![1];
const linkIn = (m: Outgoing) => /\/onboarding\/([A-Za-z0-9_-]+)/.exec(m.text)![1];

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "FollowUpSend","FollowUpEnrollment","FollowUpStep","FollowUpSequence","EmailTemplate","OnboardingRequest","SuppressedContact","LeadActivity","Lead","PipelineStage","Task","ProjectMember","Project","Mailbox","MailboxMember","MailMessage","MailThread","Notification","EmailMessage","PasswordResetToken","Session","EmployeeProfile","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Hifi Marketing and Technologies", registeredOffice: "Lahore", globalUan: "+92 42 111", website: "hifimarketing.co" } });
  const perm = await db.permission.create({ data: { key: "onboarding.approve", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "APPROVER", name: "Approver" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  const staffRole = await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales Agent" } });
  approver = (await db.user.create({ data: { organizationId: org, name: "Asad Zaman", email: "asad@hifi.test", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
  hr = (await db.user.create({ data: { organizationId: org, name: "Hina HR", email: "hina@hifi.test", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
  superAdmin = (await db.user.create({ data: { organizationId: org, name: "Root Admin", email: "root@hifi.test", passwordHash: "x" } })).id;
  sales = (await db.user.create({ data: { organizationId: org, name: "Bilal Ahmed", email: "bilal@hifi.test", phone: "+923001112223", passwordHash: "x", roles: { create: { roleId: staffRole.id } } } })).id;
  stage1 = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } })).id;
  stage2 = (await db.pipelineStage.create({ data: { organizationId: org, name: "Contacted", sortOrder: 2 } })).id;
  won = (await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 3, isWon: true } })).id;
  lost = (await db.pipelineStage.create({ data: { organizationId: org, name: "Lost", sortOrder: 4, isLost: true } })).id;
});
beforeEach(() => ok());
afterEach(() => { setTransportForTests(null); sent.length = 0; });
afterAll(async () => { await db.$disconnect(); });

const newStaff = (name: string, email: string | null) => db.user.create({ data: { organizationId: org, name, email, passwordHash: "x", mustChangePassword: true } });

describe("onboarding with an emailed code and approval", () => {
  it("emails a branded code, keeps only hashes, and blocks sign-in until verified and approved", async () => {
    const u = await newStaff("Ayesha Malik", "ayesha@new.test");
    const r = await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    expect(r.request.status).toBe("PENDING_VERIFICATION");
    expect(r.codeEmail).toBe("SENT");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ayesha@new.test");
    expect(sent[0].html).toContain("Your verification code");
    const code = codeIn(sent[0]);
    expect(sent[0].subject).toContain(code);
    const row = await db.onboardingRequest.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.codeHash).not.toContain(code);
    // The outbox never keeps the code or the link
    const out = await db.emailMessage.findFirstOrThrow({ where: { relatedId: u.id } });
    expect(out.body).not.toContain(code.slice(0, 6) + "\n");
    expect(out.body).toContain("not kept");
    expect(await signInBlock(db, u.id)).toMatch(/Verify your email/);
    await expect(startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr })).rejects.toThrow(/already started/);
  });

  it("refuses wrong codes, counts tries, and kills the code after too many", async () => {
    const u = await newStaff("Wrong Code", "wrong@new.test");
    await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    const token = linkIn(sent[0]);
    const right = codeIn(sent[0]);
    const bad = right === "000000" ? "111111" : "000000";
    await expect(verifyCode(db, { token, code: bad, password: "a-long-password", confirm: "a-long-password" })).rejects.toThrow(/tries left/);
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) await expect(verifyCode(db, { token, code: bad, password: "a-long-password", confirm: "a-long-password" })).rejects.toThrow();
    await expect(verifyCode(db, { token, code: bad, password: "a-long-password", confirm: "a-long-password" })).rejects.toThrow(/Too many wrong codes/);
    await expect(verifyCode(db, { token, code: right, password: "a-long-password", confirm: "a-long-password" })).rejects.toThrow(/expired/);
    // A new code works; the old link does not
    const t0 = new Date(Date.now() + 2 * 60_000);
    await resendCode(db, { token, now: t0 });
    await expect(resendCode(db, { token: linkIn(sent[1]), now: new Date(t0.getTime() + 1000) })).rejects.toThrow(/less than a minute/);
    expect(await onboardingByToken(db, token)).toBeNull();
    await verifyCode(db, { token: linkIn(sent[1]), code: codeIn(sent[1]), password: "a-long-password", confirm: "a-long-password" });
    expect((await db.onboardingRequest.findUniqueOrThrow({ where: { userId: u.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("verifying sets the password, verifies the email and asks every approver in the app and by email", async () => {
    const u = await newStaff("Zara Khan", "zara@new.test");
    await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    const token = linkIn(sent[0]);
    const code = codeIn(sent[0]);
    expect((await onboardingByToken(db, token))?.needsPassword).toBe(true);
    // A bad password is refused without using up a try on the code
    await expect(verifyCode(db, { token, code, password: "short", confirm: "short" })).rejects.toThrow(/10 characters/);
    await expect(verifyCode(db, { token, code, password: "a-long-password", confirm: "different-password" })).rejects.toThrow(/do not match/);
    sent.length = 0;
    await verifyCode(db, { token, code, password: "a-long-password", confirm: "a-long-password" });
    const user = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.mustChangePassword).toBe(false);
    expect(await signInBlock(db, u.id)).toMatch(/waiting for approval/);
    expect(sent.map((m) => m.to).sort()).toEqual(["asad@hifi.test", "hina@hifi.test"]);
    expect(sent[0].subject).toBe("Approve Zara Khan's account");
    expect(await db.notification.count({ where: { userId: approver, kind: "onboarding.approval" } })).toBeGreaterThan(0);
    // The link is single use
    expect(await onboardingByToken(db, token)).toBeNull();
  });

  it("needs someone other than the person who added them, unless that person is a Super Admin", async () => {
    const u = await newStaff("Omar New", "omar@new.test");
    const { request } = await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(approver), approve: true })).rejects.toThrow(/not verified/);
    await verifyCode(db, { token: linkIn(sent[0]), code: codeIn(sent[0]), password: "a-long-password", confirm: "a-long-password" });
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(hr), approve: true })).rejects.toThrow(/Someone else/);
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(sales, []), approve: true })).rejects.toThrow(/cannot approve/);
    await expect(decideOnboarding(db, { organizationId: other, requestId: request.id, actor: actor(approver), approve: true })).rejects.toThrow(/not found/);
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(u.id), approve: true })).rejects.toThrow(/your own/);
    sent.length = 0;
    await decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(approver), approve: true });
    expect(await signInBlock(db, u.id)).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("omar@new.test");
    expect(sent[0].subject).toContain("You're all set, Omar");
    expect(await db.notification.count({ where: { userId: hr, kind: "onboarding.decided" } })).toBe(1);
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(approver), approve: false, note: "x" })).rejects.toThrow(/already decided/);

    const v = await newStaff("Self Added", "self@new.test");
    const r2 = await startOnboarding(db, { organizationId: org, userId: v.id, requestedById: superAdmin });
    await verifyCode(db, { token: linkIn(sent[1]), code: codeIn(sent[1]), password: "a-long-password", confirm: "a-long-password" });
    await decideOnboarding(db, { organizationId: org, requestId: r2.request.id, actor: actor(superAdmin, [], true), approve: true });
    expect(await signInBlock(db, v.id)).toBeNull();
  });

  it("rejecting needs a reason, switches the account off and tells the person", async () => {
    const u = await newStaff("Not Hired", "nothired@new.test");
    await db.employeeProfile.create({ data: { organizationId: org, userId: u.id, employeeNo: "E-9001" } });
    const { request } = await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    await expect(decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(approver), approve: false })).rejects.toThrow(/reason/);
    sent.length = 0;
    await decideOnboarding(db, { organizationId: org, requestId: request.id, actor: actor(approver), approve: false, note: "Offer withdrawn" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).active).toBe(false);
    expect((await db.employeeProfile.findUniqueOrThrow({ where: { userId: u.id } })).status).toBe("INACTIVE");
    expect(sent[0].text).toContain("Offer withdrawn");
  });

  it("without an email address the request goes straight to the approvers, marked unverified", async () => {
    const u = await newStaff("No Email", null);
    sent.length = 0;
    const r = await startOnboarding(db, { organizationId: org, userId: u.id, requestedById: hr });
    expect(r.request.status).toBe("PENDING_APPROVAL");
    expect(sent.map((m) => m.to).sort()).toEqual(["asad@hifi.test", "hina@hifi.test"]);
    expect(sent[0].text).toContain("Not verified");
  });

  it("accounts created before onboarding existed can still sign in", async () => {
    expect(await signInBlock(db, approver)).toBeNull();
  });
});

describe("built-in template editing", () => {
  it("uses the edited wording, refuses unknown variables and resets to the default", async () => {
    await expect(saveSystemTemplate(db, { organizationId: org, key: "task_assigned", actorId: approver, content: { subject: "Task {{tsk_title}}", heading: "h", body: "b" } })).rejects.toThrow(/Unknown variable: \{\{tsk_title\}\}/);
    await expect(saveSystemTemplate(db, { organizationId: org, key: "nope", actorId: approver, content: { subject: "s", heading: "h", body: "b" } })).rejects.toThrow(/Unknown email template/);
    await saveSystemTemplate(db, { organizationId: org, key: "task_assigned", actorId: approver, content: { subject: "Heads up: {{task_title}}", heading: "New work", body: "Hi {{first_name}}" } });
    await sendTemplate(db, { organizationId: org, key: "task_assigned", to: "x@y.test", vars: { task_title: "Ship it", first_name: "Bilal" } });
    expect(sent[0].subject).toBe("Heads up: Ship it");
    await resetSystemTemplate(db, { organizationId: org, key: "task_assigned" });
    await sendTemplate(db, { organizationId: org, key: "task_assigned", to: "x@y.test", vars: { task_title: "Ship it" } });
    expect(sent[1].subject).toBe("New task: Ship it");
  });

  it("follow-up templates need a safe button link", async () => {
    await expect(saveFollowUpTemplate(db, { organizationId: org, name: "Bad", actorId: approver, content: { subject: "s", heading: "h", body: "b", buttonLabel: "Go", buttonUrl: "javascript:alert(1)" } })).rejects.toThrow(/https/);
    const t = await saveFollowUpTemplate(db, { organizationId: org, name: "Promo", actorId: approver, content: { subject: "Hi {{first_name}}", heading: "h", body: "b", buttonLabel: "Mail", buttonUrl: "mailto:{{owner_email}}" } });
    expect(t.key).toBe("followup_promo");
  });
});

describe("task and lead assignment", () => {
  it("notifies and emails the assignee once with the task template", async () => {
    const pr = await db.project.create({ data: { organizationId: org, number: "P-1", name: "Acme Retainer", managerId: approver } });
    const task = await db.task.create({ data: { projectId: pr.id, title: "Call Acme", priority: "HIGH", assigneeId: sales, dueDate: new Date("2026-11-05T00:00:00Z") } });
    await taskAssigned(db, { organizationId: org, taskId: task.id, toUserId: sales, byUserId: approver });
    await taskAssigned(db, { organizationId: org, taskId: task.id, toUserId: sales, byUserId: approver });
    expect(await db.notification.count({ where: { userId: sales, kind: "task.assigned" } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("bilal@hifi.test");
    expect(sent[0].subject).toBe("New task: Call Acme");
    expect(sent[0].text).toContain("Assigned by: Asad Zaman");
    expect(sent[0].text).toContain(`/projects/${pr.id}?task=${task.id}`);
    // Assigning to yourself sends nothing; a failing mail server never breaks the assignment
    await taskAssigned(db, { organizationId: org, taskId: task.id, toUserId: sales, byUserId: sales });
    failing();
    const t2 = await db.task.create({ data: { projectId: pr.id, title: "Send deck", assigneeId: sales } });
    await expect(taskAssigned(db, { organizationId: org, taskId: t2.id, toUserId: sales, byUserId: approver })).resolves.toBeUndefined();
    expect(await db.notification.count({ where: { userId: sales, kind: "task.assigned" } })).toBe(2);
  });

  it("emails a salesperson when a lead is assigned to them", async () => {
    const lead = await db.lead.create({ data: { organizationId: org, name: "Omar Siddiqui", email: "omar@acme.test", stageId: stage1, assignedToId: sales, source: "Website" } });
    await leadAssigned(db, { organizationId: org, leadId: lead.id, toUserId: sales, byUserId: "website" });
    expect(sent[0].subject).toBe("New lead for you: Omar Siddiqui");
  });
});

describe("follow-up sequences", () => {
  let seqId: string;
  const lead = (name: string, email: string | null, extra: Record<string, unknown> = {}) => db.lead.create({ data: { organizationId: org, name, email, stageId: stage1, assignedToId: sales, ...extra } });

  it("a starter sequence has four emails on day 0, 2, 5 and 10 and cannot start without emails", async () => {
    const empty = await createSequence(db, { organizationId: org, actorId: approver, input: { name: "Empty", trigger: "NEW_LEAD", stopOnStageChange: true, fromOwner: true } });
    await expect(setSequenceActive(db, { organizationId: org, sequenceId: empty.id, active: true })).rejects.toThrow(/at least one email/);
    const s = await createSequence(db, { organizationId: org, actorId: approver, starter: true, input: { name: "New lead nurture", trigger: "NEW_LEAD", stopOnStageChange: true, fromOwner: true } });
    seqId = s.id;
    const steps = await db.followUpStep.findMany({ where: { sequenceId: s.id }, orderBy: { position: "asc" } });
    expect(steps.map((x) => x.delayDays)).toEqual([0, 2, 5, 10]);
    await expect(setSteps(db, { organizationId: org, sequenceId: s.id, steps: [{ delayDays: 5, templateId: steps[0].templateId }, { delayDays: 2, templateId: steps[1].templateId }] })).rejects.toThrow(/in order/);
  });

  it("enrols only new leads with an email once it is switched on, sends day 0 at once and nothing twice", async () => {
    const before = await lead("Old Lead", "old@lead.test", { createdAt: new Date(Date.now() - DAY) });
    const t0 = new Date();
    await setSequenceActive(db, { organizationId: org, sequenceId: seqId, active: true, now: t0 });
    const l = await lead("Omar Fresh", "omar@fresh.test", { company: "Fresh Co", createdAt: new Date(t0.getTime() + 1000) });
    await lead("No Email", null, { createdAt: new Date(t0.getTime() + 1000) });
    sent.length = 0;
    const [r] = await runFollowUps(db, { organizationId: org, now: new Date(t0.getTime() + 5000) });
    expect(r.enrolled).toBe(1);
    expect(r.sent).toBe(1);
    expect(sent[0].to).toBe("omar@fresh.test");
    expect(sent[0].subject).toBe("Thanks for reaching out, Omar");
    expect(sent[0].html).toContain("/unsubscribe/");
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(await db.followUpEnrollment.count({ where: { leadId: before.id } })).toBe(0);
    const again = await runFollowUps(db, { organizationId: org, now: new Date(t0.getTime() + 6000) });
    expect(again[0].sent).toBe(0);
    // Day 2 brings the second email, and the lead's timeline records both
    const [d2] = await runFollowUps(db, { organizationId: org, now: new Date(t0.getTime() + 2 * DAY + 10_000) });
    expect(d2.sent).toBe(1);
    expect(sent[1].subject).toBe("Omar, a few ideas for Fresh Co");
    expect(await db.leadActivity.count({ where: { leadId: l.id, kind: "EMAIL" } })).toBe(2);
    expect((await db.followUpEnrollment.findFirstOrThrow({ where: { leadId: l.id } })).nextStep).toBe(2);
  });

  it("sends from the lead owner's own mailbox when they have one", async () => {
    await db.mailbox.create({ data: { organizationId: org, address: "bilal@hifimarketing.co", displayName: "Bilal Ahmed", kind: "PERSONAL", ownerId: sales, members: { create: { userId: sales } } } });
    const l = await lead("Mailbox Lead", "mb@lead.test");
    await enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id, actorId: sales });
    sent.length = 0;
    await runFollowUps(db, { organizationId: org, now: new Date(Date.now() + 1000) });
    const mine = sent.find((m) => m.to === "mb@lead.test")!;
    expect(mine.from).toBe("Bilal Ahmed <bilal@hifimarketing.co>");
    expect(mine.text).toContain("bilal@hifimarketing.co");
    await expect(enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id })).rejects.toThrow(/already in that sequence/);
  });

  it("stops when the lead replies, moves stage, is won or lost", async () => {
    const replied = await lead("Replier", "reply@lead.test");
    const moved = await lead("Mover", "move@lead.test");
    const winner = await lead("Winner", "win@lead.test");
    const loser = await lead("Loser", "lose@lead.test");
    for (const l of [replied, moved, winner, loser]) await enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id, now: new Date(Date.now() - 3 * DAY) });
    expect(await stopForReply(db, { organizationId: org, from: "Reply@Lead.test" })).toBe(1);
    expect(await db.notification.count({ where: { userId: sales, kind: "followup.replied" } })).toBe(1);
    await db.lead.update({ where: { id: moved.id }, data: { stageId: stage2 } });
    await db.lead.update({ where: { id: winner.id }, data: { stageId: won } });
    await db.lead.update({ where: { id: loser.id }, data: { stageId: lost } });
    sent.length = 0;
    await runFollowUps(db, { organizationId: org });
    expect(sent.filter((m) => ["reply@lead.test", "move@lead.test", "win@lead.test", "lose@lead.test"].includes(m.to))).toHaveLength(0);
    const reasons = await db.followUpEnrollment.findMany({ where: { leadId: { in: [replied.id, moved.id, winner.id, loser.id] } }, select: { leadId: true, stopReason: true } });
    expect(Object.fromEntries(reasons.map((r) => [r.leadId, r.stopReason]))).toEqual({ [replied.id]: "REPLIED", [moved.id]: "STAGE_CHANGED", [winner.id]: "WON", [loser.id]: "LOST" });
  });

  it("unsubscribing suppresses the address and stops every sequence for it; forged links are refused", async () => {
    const l = await lead("Unsub", "unsub@lead.test");
    const e = await enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id });
    const token = unsubscribeToken(e.id);
    expect(readUnsubscribeToken(token)).toBe(e.id);
    expect(readUnsubscribeToken(`${e.id}.forgedforgedforgedforgedforged12`)).toBeNull();
    await expect(unsubscribe(db, "nope.nope")).rejects.toThrow(/not valid/);
    await unsubscribe(db, token);
    await unsubscribe(db, token); // clicking twice is harmless
    expect(await db.suppressedContact.count({ where: { organizationId: org, email: "unsub@lead.test" } })).toBe(1);
    expect((await db.followUpEnrollment.findUniqueOrThrow({ where: { id: e.id } })).stopReason).toBe("UNSUBSCRIBED");
    await expect(enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id })).rejects.toThrow();
    const l2 = await lead("Unsub Again", "UNSUB@lead.test");
    await expect(enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l2.id })).rejects.toThrow(/unsubscribed/);
  });

  it("keeps leads where they are when mail is not connected or the sequence is paused, and gives up after three failures", async () => {
    const l = await lead("Waiting", "wait@lead.test");
    const e = await enrollLead(db, { organizationId: org, sequenceId: seqId, leadId: l.id });
    setTransportForTests(null);
    const [r] = await runFollowUps(db, { organizationId: org, now: new Date(Date.now() + 1000) });
    expect(r.skipped).toMatch(/not connected/);
    expect(await db.followUpSend.count({ where: { enrollmentId: e.id } })).toBe(0);
    ok();
    await setSequenceActive(db, { organizationId: org, sequenceId: seqId, active: false });
    expect(await runFollowUps(db, { organizationId: org })).toEqual([]);
    await setSequenceActive(db, { organizationId: org, sequenceId: seqId, active: true });
    failing();
    for (let i = 0; i < 3; i++) await runFollowUps(db, { organizationId: org, now: new Date(Date.now() + (i + 1) * 2 * 3600_000) });
    const after = await db.followUpEnrollment.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("STOPPED");
    expect(after.stopReason).toBe("SEND_FAILED");
  });
});
