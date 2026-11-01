"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MailError, sendEmail } from "@/lib/mailer";
import { brandFor, saveFollowUpTemplate, setFollowUpTemplateArchived } from "@/lib/email-template-store";
import { FOLLOW_UP_VARIABLES, renderEmail } from "@/lib/email-templates";
import { FollowUpError, createSequence, enrollLead, setSequenceActive, setSteps, stopEnrollment, updateSequence, type SequenceInput } from "@/lib/followups";
import { leadScope } from "@/lib/leads";
import type { EditorState } from "@/components/EmailTemplateEditor";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const go = (to: string, kind: "ok" | "error" | "saved", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);
const input = (f: FormData): SequenceInput => ({
  name: s(f, "name"), description: s(f, "description"), trigger: s(f, "trigger") || "NEW_LEAD", leadSourceId: s(f, "leadSourceId") || null, tag: s(f, "tag") || null,
  stopOnStageChange: f.get("stopOnStageChange") === "on", mailboxId: s(f, "mailboxId") || null, fromOwner: f.get("fromOwner") === "on",
});

export async function createSequenceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("followups.manage");
  let id = "";
  try {
    const seq = await createSequence(db, { organizationId: user.organizationId, actorId: user.id, starter: formData.get("starter") === "on", input: { ...input(formData), stopOnStageChange: true, fromOwner: true } });
    await audit(user, { action: "followup.sequence.create", entity: "FollowUpSequence", entityId: seq.id, after: { name: seq.name } });
    id = seq.id;
  } catch (e) {
    if (e instanceof FollowUpError) go("/leads/follow-ups", "error", e.message);
    throw e;
  }
  go(`/leads/follow-ups/${id}`, "ok", "Sequence created. Check the emails and settings, then switch it on.");
}

export async function updateSequenceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("followups.manage");
  const id = s(formData, "id");
  try {
    await updateSequence(db, { organizationId: user.organizationId, sequenceId: id, input: input(formData) });
    await audit(user, { action: "followup.sequence.update", entity: "FollowUpSequence", entityId: id });
  } catch (e) {
    if (e instanceof FollowUpError) go(`/leads/follow-ups/${id}`, "error", e.message);
    throw e;
  }
  revalidatePath("/leads/follow-ups");
  go(`/leads/follow-ups/${id}`, "ok", "Settings saved.");
}

export async function setStepsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("followups.manage");
  const id = s(formData, "id");
  const rows = formData.getAll("templateId").map((t, i) => ({ templateId: String(t), delay: String(formData.getAll("delayDays")[i] ?? "") }));
  const remove = formData.getAll("remove").map(String);
  const steps = rows.filter((r, i) => r.templateId && !remove.includes(String(i))).map((r) => ({ templateId: r.templateId, delayDays: Number(r.delay) }));
  try {
    await setSteps(db, { organizationId: user.organizationId, sequenceId: id, steps });
    await audit(user, { action: "followup.sequence.steps", entity: "FollowUpSequence", entityId: id, after: { steps: steps.map((x) => x.delayDays) } });
  } catch (e) {
    if (e instanceof FollowUpError) go(`/leads/follow-ups/${id}`, "error", e.message);
    throw e;
  }
  go(`/leads/follow-ups/${id}`, "ok", "Emails saved.");
}

export async function toggleSequenceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("followups.manage");
  const id = s(formData, "id");
  const on = s(formData, "active") === "1";
  try {
    await setSequenceActive(db, { organizationId: user.organizationId, sequenceId: id, active: on });
    await audit(user, { action: on ? "followup.sequence.start" : "followup.sequence.pause", entity: "FollowUpSequence", entityId: id });
  } catch (e) {
    if (e instanceof FollowUpError) go(`/leads/follow-ups/${id}`, "error", e.message);
    throw e;
  }
  revalidatePath("/leads/follow-ups");
  go(`/leads/follow-ups/${id}`, "ok", on ? "Switched on. New leads join it automatically and due emails go out on the next run." : "Paused. Nothing is sent until you switch it on again.");
}

// From the sequence page (followups.manage) or the lead page (anyone who can edit that lead).
export async function enrollAction(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const leadId = s(formData, "leadId");
  const back = `/leads/${leadId}`;
  if (!(await db.lead.findFirst({ where: { id: leadId, ...leadScope(user) }, select: { id: true } }))) redirect("/leads");
  try {
    const e = await enrollLead(db, { organizationId: user.organizationId, sequenceId: s(formData, "sequenceId"), leadId, actorId: user.id });
    await audit(user, { action: "followup.enroll", entity: "Lead", entityId: leadId, after: { sequenceId: e.sequenceId } });
  } catch (err) {
    if (err instanceof FollowUpError) go(back, "error", err.message);
    throw err;
  }
  go(back, "saved", "Added to the follow-up sequence. The first email goes out on the next run.");
}

export async function stopEnrollmentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "enrollmentId");
  const back = s(formData, "back").startsWith("/leads/") ? s(formData, "back") : "/leads/follow-ups";
  const e = await db.followUpEnrollment.findFirst({ where: { id, organizationId: user.organizationId } });
  // Managers of sequences can stop anyone's; others only for leads they may open
  if (!e || (!user.permissions.has("followups.manage") && !(await db.lead.findFirst({ where: { id: e.leadId, ...leadScope(user) }, select: { id: true } })))) redirect("/leads");
  try {
    await stopEnrollment(db, { organizationId: user.organizationId, enrollmentId: id, reason: "MANUAL", actorId: user.id });
    await audit(user, { action: "followup.stop", entity: "Lead", entityId: e.leadId, after: { sequenceId: e.sequenceId } });
  } catch (err) {
    if (err instanceof FollowUpError) go(back, "error", err.message);
    throw err;
  }
  go(back, back.startsWith("/leads/follow-ups") ? "ok" : "saved", "Follow-up stopped.");
}

export async function saveFollowUpTemplateAction(prev: EditorState, formData: FormData): Promise<EditorState> {
  const user = await requirePermission("followups.manage");
  const id = s(formData, "id") || null;
  const n = (prev.n ?? 0) + 1;
  let savedId: string;
  try {
    const content = { subject: s(formData, "subject"), preheader: s(formData, "preheader"), heading: s(formData, "heading"), body: s(formData, "body"), buttonLabel: s(formData, "buttonLabel"), buttonUrl: s(formData, "buttonUrl"), highlights: s(formData, "highlights") };
    const t = await saveFollowUpTemplate(db, { organizationId: user.organizationId, id, name: s(formData, "name"), content, actorId: user.id });
    savedId = t.id;
    await audit(user, { action: "followup.template.save", entity: "EmailTemplate", entityId: t.id, after: { name: t.name } });
    if (s(formData, "intent") === "test") {
      if (!user.email) return { error: "Saved, but your account has no email address to send a test to.", n };
      const brand = await brandFor(db, user.organizationId);
      const r = renderEmail({ content, vars: { ...FOLLOW_UP_VARIABLES, company_name: brand.company }, brand, unsubscribeUrl: `${brand.appUrl}/unsubscribe/test`, footerNote: `You are receiving this because you contacted ${brand.company}.` });
      const m = await sendEmail(db, { organizationId: user.organizationId, to: user.email, subject: `[Test] ${r.subject}`, text: r.text, html: r.html, relatedType: "TEST", actorId: user.id });
      if (m.status !== "SENT") return { error: `Saved, but the test was not sent: ${m.error ?? m.status}`, n };
    }
  } catch (e) {
    if (e instanceof MailError) return { error: e.message, n };
    throw e;
  }
  revalidatePath("/leads/follow-ups");
  if (!id) redirect(`/leads/follow-ups/templates/${savedId}?ok=${encodeURIComponent("Template created.")}`);
  return { ok: s(formData, "intent") === "test" ? `Saved, and a test with sample values went to ${user.email}.` : "Saved. Emails not yet sent use the new wording.", n };
}

export async function archiveFollowUpTemplateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("followups.manage");
  const id = s(formData, "id");
  const archived = s(formData, "archived") === "1";
  try {
    await setFollowUpTemplateArchived(db, { organizationId: user.organizationId, id, archived });
    await audit(user, { action: archived ? "followup.template.archive" : "followup.template.restore", entity: "EmailTemplate", entityId: id });
  } catch (e) {
    if (e instanceof MailError) go(`/leads/follow-ups/templates/${id}`, "error", e.message);
    throw e;
  }
  go(archived ? "/leads/follow-ups" : `/leads/follow-ups/templates/${id}`, "ok", archived ? "Template archived." : "Template restored.");
}
