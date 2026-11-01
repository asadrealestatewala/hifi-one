// CRM follow-up automation (GoHighLevel-style): a sequence is a timed series of emails (day 0, 2, 5, 10 ...) that new leads are
// enrolled in. The runner (runFollowUps) enrols matching new leads and sends whatever is due; it is safe to run every few
// minutes from several places at once. Free of Next.js imports so it can be tested against the database.
//
// Rules enforced here:
// - Only leads with an email address that is not on the do-not-contact list are enrolled or emailed.
// - A sequence stops for a lead when they reply (any company mailbox receives mail from them), unsubscribe, are won, lost or
//   converted, or (when the sequence says so) move to another pipeline stage. Stopping is final for that sequence.
// - Each step is sent at most once per lead: a unique row is claimed before sending, so overlapping runners cannot double-send.
// - Every email carries an unsubscribe link and List-Unsubscribe headers. Unsubscribing adds the address to the do-not-contact
//   list and stops every sequence for it.
// - A paused sequence sends nothing and enrols nobody; its leads resume where they were when it is switched on again.
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { MailError, sendEmail } from "./mailer";
import { FOLLOW_UP_VARIABLES, renderEmail } from "./email-templates";
import { appUrl, brandFor, ensureStarterTemplates, firstName } from "./email-template-store";
import { lower } from "./mail-store";
import { notify } from "./notifications";

type Db = PrismaClient;
export class FollowUpError extends Error {}

export const MAX_STEPS = 12;
export const MAX_DELAY_DAYS = 365;
export const STOP_REASONS: Record<string, string> = {
  REPLIED: "Replied", STAGE_CHANGED: "Moved to another stage", UNSUBSCRIBED: "Unsubscribed", WON: "Won or converted", LOST: "Lost",
  MANUAL: "Stopped by a person", SEND_FAILED: "Emails kept failing", NO_EMAIL: "No email address", SUPPRESSED: "On the do-not-contact list",
};
const DAY = 86_400_000;
const BATCH = 50;

// ---------- unsubscribe links ----------

const secret = (env: Record<string, string | undefined> = process.env) => env.SESSION_SECRET || "hifi-one-dev-secret";
const sign = (id: string) => crypto.createHmac("sha256", secret()).update(`unsubscribe:${id}`).digest("base64url").slice(0, 32);
export const unsubscribeToken = (enrollmentId: string) => `${enrollmentId}.${sign(enrollmentId)}`;
export function readUnsubscribeToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || id.length > 40) return null;
  const want = sign(id);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}

export async function isSuppressed(db: Db | Prisma.TransactionClient, organizationId: string, email: string) {
  return Boolean(await db.suppressedContact.findFirst({ where: { organizationId, email: { equals: lower(email), mode: "insensitive" } } }));
}

// ---------- sequences ----------

export type SequenceInput = { name: string; description?: string | null; trigger: string; leadSourceId?: string | null; tag?: string | null; stopOnStageChange: boolean; mailboxId?: string | null; fromOwner: boolean };

async function cleanSequence(db: Db, organizationId: string, i: SequenceInput) {
  const name = i.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 2) throw new FollowUpError("Name the sequence.");
  if (!["NEW_LEAD", "MANUAL"].includes(i.trigger)) throw new FollowUpError("Choose when leads join the sequence.");
  if (i.leadSourceId && !(await db.leadSource.findFirst({ where: { id: i.leadSourceId, organizationId } }))) throw new FollowUpError("Unknown website form.");
  if (i.mailboxId && !(await db.mailbox.findFirst({ where: { id: i.mailboxId, organizationId, active: true } }))) throw new FollowUpError("Choose an active mailbox to send from.");
  return {
    name, description: (i.description ?? "").trim().slice(0, 500) || null, trigger: i.trigger, leadSourceId: i.leadSourceId || null,
    tag: (i.tag ?? "").trim().toLowerCase().slice(0, 30) || null, stopOnStageChange: i.stopOnStageChange, mailboxId: i.mailboxId || null, fromOwner: i.fromOwner,
  };
}

export async function createSequence(db: Db, p: { organizationId: string; actorId: string; input: SequenceInput; starter?: boolean }) {
  const data = await cleanSequence(db, p.organizationId, p.input);
  const starter = p.starter ? await ensureStarterTemplates(db, { organizationId: p.organizationId, actorId: p.actorId }) : [];
  return db.followUpSequence.create({
    data: { organizationId: p.organizationId, ...data, createdById: p.actorId, active: false, steps: { create: starter.map((s, i) => ({ position: i, delayDays: s.delayDays, templateId: s.id })) } },
  });
}

export async function updateSequence(db: Db, p: { organizationId: string; sequenceId: string; input: SequenceInput }) {
  const seq = await db.followUpSequence.findFirst({ where: { id: p.sequenceId, organizationId: p.organizationId } });
  if (!seq) throw new FollowUpError("Sequence not found.");
  return db.followUpSequence.update({ where: { id: seq.id }, data: await cleanSequence(db, p.organizationId, p.input) });
}

// Steps are replaced as a whole: [{ delayDays, templateId }] in order. Delays must not go backwards.
export async function setSteps(db: Db, p: { organizationId: string; sequenceId: string; steps: { delayDays: number; templateId: string }[] }) {
  const seq = await db.followUpSequence.findFirst({ where: { id: p.sequenceId, organizationId: p.organizationId } });
  if (!seq) throw new FollowUpError("Sequence not found.");
  if (p.steps.length > MAX_STEPS) throw new FollowUpError(`A sequence can have at most ${MAX_STEPS} emails.`);
  let last = -1;
  for (const s of p.steps) {
    if (!Number.isInteger(s.delayDays) || s.delayDays < 0 || s.delayDays > MAX_DELAY_DAYS) throw new FollowUpError(`Use whole days from 0 to ${MAX_DELAY_DAYS}.`);
    if (s.delayDays < last) throw new FollowUpError("Put the emails in order: each one on the same day as the one before it, or later.");
    last = s.delayDays;
  }
  const ids = [...new Set(p.steps.map((s) => s.templateId))];
  if ((await db.emailTemplate.count({ where: { id: { in: ids }, organizationId: p.organizationId, kind: "FOLLOW_UP", archived: false } })) !== ids.length) throw new FollowUpError("Choose a follow-up template for every email.");
  if (seq.active && p.steps.length === 0) throw new FollowUpError("Pause the sequence before removing all of its emails.");
  await db.$transaction([
    db.followUpStep.deleteMany({ where: { sequenceId: seq.id } }),
    db.followUpStep.createMany({ data: p.steps.map((s, i) => ({ sequenceId: seq.id, position: i, delayDays: s.delayDays, templateId: s.templateId })) }),
  ]);
  // Leads part-way through get their next email re-timed to the new plan
  const active = await db.followUpEnrollment.findMany({ where: { sequenceId: seq.id, status: "ACTIVE" } });
  for (const e of active) {
    const next = p.steps[e.nextStep];
    await db.followUpEnrollment.update({ where: { id: e.id }, data: next ? { nextSendAt: new Date(e.enrolledAt.getTime() + next.delayDays * DAY) } : { status: "COMPLETED", nextSendAt: null } });
  }
}

export async function setSequenceActive(db: Db, p: { organizationId: string; sequenceId: string; active: boolean; now?: Date }) {
  const seq = await db.followUpSequence.findFirst({ where: { id: p.sequenceId, organizationId: p.organizationId }, include: { _count: { select: { steps: true } } } });
  if (!seq) throw new FollowUpError("Sequence not found.");
  if (p.active && seq._count.steps === 0) throw new FollowUpError("Add at least one email before switching the sequence on.");
  // Automatic enrolment covers leads created from the moment it is first switched on, never the whole back catalogue
  return db.followUpSequence.update({ where: { id: seq.id }, data: { active: p.active, ...(p.active && !seq.activatedAt ? { activatedAt: p.now ?? new Date() } : {}) } });
}

// ---------- enrolment ----------

export async function enrollLead(db: Db, p: { organizationId: string; sequenceId: string; leadId: string; actorId?: string | null; now?: Date }) {
  const now = p.now ?? new Date();
  const [seq, lead] = await Promise.all([
    db.followUpSequence.findFirst({ where: { id: p.sequenceId, organizationId: p.organizationId }, include: { steps: { orderBy: { position: "asc" } } } }),
    db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, include: { stage: true } }),
  ]);
  if (!seq) throw new FollowUpError("Sequence not found.");
  if (!lead) throw new FollowUpError("Lead not found.");
  if (!seq.steps.length) throw new FollowUpError("This sequence has no emails yet.");
  if (!lead.email) throw new FollowUpError("This lead has no email address.");
  if (lead.convertedAt || lead.stage.isWon || lead.stage.isLost) throw new FollowUpError("This lead is already won, lost or converted.");
  if (await isSuppressed(db, p.organizationId, lead.email)) throw new FollowUpError("This email address unsubscribed or is on the do-not-contact list.");
  if (await db.followUpEnrollment.findUnique({ where: { sequenceId_leadId: { sequenceId: seq.id, leadId: lead.id } } })) throw new FollowUpError("This lead is already in that sequence. A stopped sequence does not restart.");
  try {
    return await db.followUpEnrollment.create({
      data: {
        organizationId: p.organizationId, sequenceId: seq.id, leadId: lead.id, email: lower(lead.email), stageIdAtStart: lead.stageId, enrolledById: p.actorId ?? null,
        enrolledAt: now, nextSendAt: new Date(now.getTime() + seq.steps[0].delayDays * DAY),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new FollowUpError("This lead is already in that sequence.");
    throw e;
  }
}

export async function stopEnrollment(db: Db, p: { organizationId: string; enrollmentId: string; reason: keyof typeof STOP_REASONS; actorId?: string | null; now?: Date }) {
  const r = await db.followUpEnrollment.updateMany({ where: { id: p.enrollmentId, organizationId: p.organizationId, status: "ACTIVE" }, data: { status: "STOPPED", stopReason: p.reason, stoppedAt: p.now ?? new Date(), stoppedById: p.actorId ?? null, nextSendAt: null } });
  if (!r.count) throw new FollowUpError("That follow-up is not running.");
}

// New leads (created after the sequence was switched on) that match its filters join it.
export async function autoEnroll(db: Db, organizationId: string, now: Date) {
  const seqs = await db.followUpSequence.findMany({ where: { organizationId, active: true, trigger: "NEW_LEAD", activatedAt: { not: null }, steps: { some: {} } } });
  let n = 0;
  for (const s of seqs) {
    const leads = await db.lead.findMany({
      where: {
        organizationId, createdAt: { gte: s.activatedAt! }, email: { not: null }, convertedAt: null, stage: { isWon: false, isLost: false },
        followUps: { none: { sequenceId: s.id } }, ...(s.leadSourceId ? { leadSourceId: s.leadSourceId } : {}), ...(s.tag ? { tags: { has: s.tag } } : {}),
      },
      select: { id: true, email: true }, orderBy: { createdAt: "asc" }, take: 200,
    });
    for (const l of leads) {
      if (await isSuppressed(db, organizationId, l.email!)) continue;
      try { await enrollLead(db, { organizationId, sequenceId: s.id, leadId: l.id, now }); n++; } catch (e) { if (!(e instanceof FollowUpError)) throw e; }
    }
  }
  return n;
}

// ---------- sending ----------

// Why an enrolment must stop now, or null to carry on.
async function stopReason(db: Db, e: { organizationId: string; email: string; stageIdAtStart: string }, lead: { email: string | null; convertedAt: Date | null; stageId: string; stage: { isWon: boolean; isLost: boolean } } | null, stopOnStageChange: boolean) {
  if (!lead || !lead.email) return "NO_EMAIL";
  if (await isSuppressed(db, e.organizationId, e.email)) return "UNSUBSCRIBED";
  if (lead.convertedAt || lead.stage.isWon) return "WON";
  if (lead.stage.isLost) return "LOST";
  if (stopOnStageChange && lead.stageId !== e.stageIdAtStart) return "STAGE_CHANGED";
  return null;
}

export type RunSummary = { enrolled: number; sent: number; stopped: number; failed: number; skipped: string | null };

export async function processDue(db: Db, organizationId: string, now: Date): Promise<Omit<RunSummary, "enrolled">> {
  const out = { sent: 0, stopped: 0, failed: 0, skipped: null as string | null };
  const due = await db.followUpEnrollment.findMany({
    where: { organizationId, status: "ACTIVE", nextSendAt: { lte: now }, sequence: { active: true } },
    include: { sequence: { include: { steps: { orderBy: { position: "asc" }, include: { template: true } } } } }, orderBy: { nextSendAt: "asc" }, take: BATCH,
  });
  if (!due.length) return out;
  const brand = await brandFor(db, organizationId);
  for (const e of due) {
    const lead = await db.lead.findUnique({ where: { id: e.leadId }, include: { stage: { select: { isWon: true, isLost: true } } } });
    const why = await stopReason(db, e, lead, e.sequence.stopOnStageChange);
    if (why) {
      await db.followUpEnrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: why, stoppedAt: now, nextSendAt: null } });
      out.stopped++;
      continue;
    }
    const step = e.sequence.steps[e.nextStep];
    if (!step) {
      await db.followUpEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextSendAt: null } });
      continue;
    }
    // Claim the step first: if another runner got here, the unique key refuses and this one moves on
    let claim;
    try { claim = await db.followUpSend.create({ data: { enrollmentId: e.id, position: step.position, status: "SENDING" } }); }
    catch (err) { if ((err as { code?: string }).code === "P2002") continue; throw err; }

    const owner = lead!.assignedToId ? await db.user.findUnique({ where: { id: lead!.assignedToId }, select: { id: true, name: true, email: true, phone: true } }) : null;
    const ownerBox = e.sequence.fromOwner && owner ? await db.mailbox.findFirst({ where: { organizationId, ownerId: owner.id, kind: "PERSONAL", active: true }, orderBy: { createdAt: "asc" } }) : null;
    const mailboxId = ownerBox?.id ?? e.sequence.mailboxId;
    const t = step.template;
    const vars = {
      ...Object.fromEntries(Object.keys(FOLLOW_UP_VARIABLES).map((k) => [k, ""])),
      first_name: firstName(lead!.name), lead_name: lead!.name, lead_company: lead!.company ?? lead!.name, service: lead!.serviceInterest ?? "your project",
      owner_name: owner?.name ?? brand.company, owner_first_name: firstName(owner?.name) || "the team", owner_email: ownerBox?.address ?? owner?.email ?? brand.email ?? "",
      owner_phone: owner?.phone ?? brand.phone ?? "", company_name: brand.company, website: brand.website ? (/^https?:/i.test(brand.website) ? brand.website : `https://${brand.website}`) : appUrl(),
    };
    const unsub = `${appUrl()}/unsubscribe/${unsubscribeToken(e.id)}`;
    const r = renderEmail({
      content: { subject: t.subject, preheader: t.preheader, heading: t.heading, body: t.body, buttonLabel: t.buttonLabel, buttonUrl: t.buttonUrl, highlights: t.highlights },
      vars, brand, unsubscribeUrl: unsub, footerNote: `You are receiving this because you contacted ${brand.company}.`,
    });
    let status: string, error: string | null = null, messageId: string | null = null;
    try {
      const m = await sendEmail(db, {
        organizationId, to: e.email, subject: r.subject, text: r.text, html: r.html, relatedType: "FOLLOW_UP", relatedId: e.id, mailboxId, now,
        headers: { "List-Unsubscribe": `<${appUrl()}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(e.id))}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      status = m.status; error = m.error; messageId = m.id;
    } catch (err) {
      if (!(err instanceof MailError)) throw err;
      // Over the hourly allowance or a bad address: give the step back and try on a later run
      await db.followUpSend.delete({ where: { id: claim.id } });
      if (/limit/i.test(err.message)) { out.skipped = err.message; break; }
      await db.followUpEnrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: "NO_EMAIL", stoppedAt: now, nextSendAt: null } });
      out.stopped++;
      continue;
    }
    if (status === "NOT_CONFIGURED") {
      // Mail is switched off: nothing went out, so keep every lead where it is and stop this run
      await db.followUpSend.delete({ where: { id: claim.id } });
      out.skipped = "Email is not connected, so nothing was sent.";
      break;
    }
    if (status !== "SENT") {
      out.failed++;
      const failures = e.failures + 1;
      await db.followUpSend.delete({ where: { id: claim.id } });
      await db.followUpEnrollment.update({ where: { id: e.id }, data: failures >= 3 ? { failures, status: "STOPPED", stopReason: "SEND_FAILED", stoppedAt: now, nextSendAt: null } : { failures, nextSendAt: new Date(now.getTime() + 3600_000) } });
      if (failures >= 3 && owner) await notify(db, owner.id, { kind: "followup.failed", title: `Follow-up emails to ${lead!.name} keep failing`, body: error ?? undefined, link: `/leads/${lead!.id}`, dedupeKey: `followup-failed:${e.id}` });
      continue;
    }
    out.sent++;
    await db.followUpSend.update({ where: { id: claim.id }, data: { status: "SENT", emailMessageId: messageId, subject: r.subject } });
    const next = e.sequence.steps[e.nextStep + 1];
    await db.followUpEnrollment.update({
      where: { id: e.id },
      data: next ? { nextStep: e.nextStep + 1, failures: 0, nextSendAt: new Date(Math.max(now.getTime(), e.enrolledAt.getTime() + next.delayDays * DAY)) } : { nextStep: e.nextStep + 1, failures: 0, status: "COMPLETED", nextSendAt: null },
    });
    await db.leadActivity.create({ data: { leadId: lead!.id, kind: "EMAIL", body: `Follow-up email sent (${e.sequence.name}, email ${step.position + 1}): ${r.subject}` } });
    await db.lead.update({ where: { id: lead!.id }, data: { lastContactAt: now } });
  }
  return out;
}

export async function runFollowUps(db: Db, o: { now?: Date; organizationId?: string } = {}) {
  const now = o.now ?? new Date();
  const orgs = await db.organization.findMany({ where: o.organizationId ? { id: o.organizationId } : {}, select: { id: true } });
  const results: (RunSummary & { organizationId: string })[] = [];
  for (const org of orgs) {
    if (!(await db.followUpSequence.count({ where: { organizationId: org.id, active: true } }))) continue;
    const enrolled = await autoEnroll(db, org.id, now);
    const r = await processDue(db, org.id, now);
    results.push({ organizationId: org.id, enrolled, ...r });
  }
  return results;
}

// ---------- replies and unsubscribes ----------

// A company mailbox received an email: every running follow-up to that sender stops, and the lead's owner is told.
export async function stopForReply(db: Db, p: { organizationId: string; from: string; threadId?: string | null; now?: Date }) {
  const now = p.now ?? new Date();
  const running = await db.followUpEnrollment.findMany({ where: { organizationId: p.organizationId, email: lower(p.from), status: "ACTIVE" }, include: { sequence: { select: { name: true } } } });
  for (const e of running) {
    await db.followUpEnrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: "REPLIED", stoppedAt: now, nextSendAt: null } });
    const lead = await db.lead.findUnique({ where: { id: e.leadId }, select: { id: true, name: true, assignedToId: true } });
    if (!lead) continue;
    await db.leadActivity.create({ data: { leadId: lead.id, kind: "EMAIL", body: `Replied by email, so the "${e.sequence.name}" follow-up stopped` } });
    if (lead.assignedToId) await notify(db, lead.assignedToId, { kind: "followup.replied", title: `${lead.name} replied`, body: `The "${e.sequence.name}" follow-up stopped.`, link: p.threadId ? `/mail/${p.threadId}` : `/leads/${lead.id}`, dedupeKey: `followup-replied:${e.id}` });
  }
  return running.length;
}

export async function unsubscribe(db: Db, token: string, now = new Date()) {
  const id = readUnsubscribeToken(token);
  if (!id) throw new FollowUpError("This unsubscribe link is not valid.");
  const e = await db.followUpEnrollment.findUnique({ where: { id } });
  if (!e) throw new FollowUpError("This unsubscribe link is not valid.");
  if (!(await isSuppressed(db, e.organizationId, e.email))) {
    await db.suppressedContact.create({ data: { organizationId: e.organizationId, email: e.email, reason: "Unsubscribed from follow-up emails" } });
  }
  const stopped = await db.followUpEnrollment.updateMany({ where: { organizationId: e.organizationId, email: e.email, status: "ACTIVE" }, data: { status: "STOPPED", stopReason: "UNSUBSCRIBED", stoppedAt: now, nextSendAt: null } });
  if (stopped.count) await db.leadActivity.create({ data: { leadId: e.leadId, kind: "EMAIL", body: "Unsubscribed from follow-up emails" } });
  return { email: e.email };
}
