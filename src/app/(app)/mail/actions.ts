"use server";

import { redirect } from "next/navigation";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MailError } from "@/lib/mailer";
import { markThread, sendFromMailbox, threadFor } from "@/lib/mailboxes";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const withMsg = (to: string, kind: "ok" | "error", msg: string) => `${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`;

// Compose a new email or reply in a conversation. Access is by mailbox membership, checked again in sendFromMailbox.
export async function sendMailAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const threadId = s(formData, "threadId") || null;
  const back = threadId ? `/mail/${threadId}` : `/mail/compose?box=${encodeURIComponent(s(formData, "mailboxId"))}`;
  let dest: string;
  try {
    const m = await sendFromMailbox(db, { user, mailboxId: s(formData, "mailboxId"), to: s(formData, "to"), cc: s(formData, "cc"), subject: s(formData, "subject"), text: s(formData, "text"), threadId });
    await audit(user, { action: "mail.send", entity: "MailMessage", entityId: m.id, after: { mailboxId: m.mailboxId, to: m.toAddresses, status: m.status } });
    dest = m.status === "SENT" ? withMsg(`/mail/${m.threadId}`, "ok", "Sent.")
      : withMsg(`/mail/${m.threadId}`, "error", m.status === "NOT_CONFIGURED" ? "Email is not connected, so nothing was sent. The draft is kept in this conversation." : `Not sent: ${m.error}`);
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    dest = withMsg(back, "error", e.message);
  }
  redirect(dest);
}

export async function markThreadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = s(formData, "id");
  const op = s(formData, "op");
  if (!["read", "unread", "archive", "unarchive"].includes(op)) redirect("/mail");
  const t = await threadFor(db, user, id);
  if (!t) redirect("/mail");
  await markThread(db, user, id, op as "read" | "unread" | "archive" | "unarchive");
  redirect(op === "archive" || op === "unread" ? `/mail?box=${t.mailboxId}` : `/mail/${id}`);
}
