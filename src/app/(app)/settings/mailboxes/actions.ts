"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MailError } from "@/lib/mailer";
import { addMember, createMailbox, removeMember, setupStandardMailboxes, updateMailbox } from "@/lib/mailboxes";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const go = (to: string, kind: "ok" | "error", msg: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);

async function companyName(organizationId: string) {
  const p = await db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { tradingName: true, legalName: true } });
  return p?.tradingName || p?.legalName || (await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name || "Hifi Marketing";
}

export async function setupStandardAction(): Promise<void> {
  const user = await requirePermission("mail.manage");
  const made = await setupStandardMailboxes(db, { organizationId: user.organizationId, actorId: user.id, companyName: await companyName(user.organizationId) });
  await audit(user, { action: "mailbox.setup_standard", entity: "Mailbox", after: { created: made } });
  go("/settings/mailboxes", "ok", made.length ? `Created ${made.join(", ")}. Add the people who should use each one.` : "The standard mailboxes already exist.");
}

export async function createMailboxAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mail.manage");
  const kind = s(formData, "kind") === "SHARED" ? "SHARED" : "PERSONAL";
  let id: string | null = null;
  try {
    const mb = await createMailbox(db, { organizationId: user.organizationId, actorId: user.id, kind, localPart: s(formData, "localPart"), displayName: s(formData, "displayName"), ownerId: kind === "PERSONAL" ? s(formData, "ownerId") : null });
    await audit(user, { action: "mailbox.create", entity: "Mailbox", entityId: mb.id, after: { address: mb.address, kind: mb.kind, ownerId: mb.ownerId } });
    id = mb.id;
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    go("/settings/mailboxes", "error", e.message);
  }
  go(`/settings/mailboxes/${id}`, "ok", "Mailbox created.");
}

export async function updateMailboxAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mail.manage");
  const id = s(formData, "id");
  const op = s(formData, "op");
  try {
    const mb = await updateMailbox(db, {
      organizationId: user.organizationId, mailboxId: id,
      ...(op === "deactivate" ? { active: false } : op === "activate" ? { active: true } : { displayName: s(formData, "displayName"), signature: s(formData, "signature") }),
    });
    await audit(user, { action: `mailbox.${op || "update"}`, entity: "Mailbox", entityId: mb.id, after: { displayName: mb.displayName, active: mb.active } });
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    go(`/settings/mailboxes/${id}`, "error", e.message);
  }
  go(`/settings/mailboxes/${id}`, "ok", op === "deactivate" ? "Mailbox switched off. Its conversations are kept." : op === "activate" ? "Mailbox switched on." : "Saved.");
}

export async function memberAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mail.manage");
  const id = s(formData, "id");
  const userId = s(formData, "userId");
  const op = s(formData, "op");
  try {
    if (op === "remove") await removeMember(db, { organizationId: user.organizationId, mailboxId: id, userId });
    else {
      const canSend = op === "allow-send" ? true : op === "read-only" ? false : s(formData, "canSend") === "on";
      await addMember(db, { organizationId: user.organizationId, mailboxId: id, userId, canSend });
    }
    await audit(user, { action: `mailbox.member.${op || "add"}`, entity: "Mailbox", entityId: id, after: { userId } });
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    go(`/settings/mailboxes/${id}`, "error", e.message);
  }
  go(`/settings/mailboxes/${id}`, "ok", op === "remove" ? "Removed." : "Saved.");
}
