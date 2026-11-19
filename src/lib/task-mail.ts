// Answering task emails from the inbox. Every task email (task assigned, @mention, a comment shared with the client) carries a
// private Reply-To address for that person and task: reply-<token>@<company mail domain>. Resend receives mail for the whole
// domain and calls /api/mail/inbound; a reply to such an address becomes a comment on the task, written as that person, with the
// quoted earlier email cut off. It is only accepted when it comes from the email address of the person the address was made for,
// that person is still active and still allowed to comment there (staff: on the project team; clients: the task is shared with
// their company), and the text is not empty. Staff replies are internal comments and notify like any comment; client replies are
// shared and notify the team as portal comments do. A retried webhook never adds a second comment (TaskComment.sourceEmailId).
// No reply address is offered while receiving is not configured or the company has no mailbox domain, so nobody is told to reply
// into nothing. Free of Next.js imports so it can be tested against the database.
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { receivingConfig } from "./mailboxes";

type Db = PrismaClient;
const TOKEN = /^reply-([a-z0-9]{24})@/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const newToken = () => Array.from(randomBytes(24), (b) => ALPHABET[b % 36]).join("");

// The domain replies go to: the company's no-reply mailbox, or else any active mailbox. Null when replies cannot be received.
export async function replyDomain(db: Db, organizationId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!receivingConfig(env).configured) return null;
  const mb = (await db.mailbox.findFirst({ where: { organizationId, active: true, purpose: "NOREPLY" }, select: { address: true } }))
    ?? (await db.mailbox.findFirst({ where: { organizationId, active: true }, orderBy: { createdAt: "asc" }, select: { address: true } }));
  const domain = mb?.address.split("@")[1]?.toLowerCase();
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

// This person's reply address for this task, created on first use. Null when replies cannot be received.
export async function replyAddressFor(db: Db, p: { organizationId: string; taskId: string; userId: string; env?: Record<string, string | undefined> }): Promise<string | null> {
  const domain = await replyDomain(db, p.organizationId, p.env);
  if (!domain) return null;
  const found = await db.taskReplyAddress.findUnique({ where: { taskId_userId: { taskId: p.taskId, userId: p.userId } }, select: { token: true } });
  if (found) return `reply-${found.token}@${domain}`;
  const made = await db.taskReplyAddress.upsert({ where: { taskId_userId: { taskId: p.taskId, userId: p.userId } }, create: { taskId: p.taskId, userId: p.userId, token: newToken() }, update: {}, select: { token: true } });
  return `reply-${made.token}@${domain}`;
}

export const REPLY_NOTE = "You can reply to this email: your reply is added to the task as a comment.";
export const replyNote = (address: string | null) => (address ? REPLY_NOTE : "");

// The new part of a reply: everything before the quoted earlier message, the "On … wrote:" line, an Outlook header block or a
// signature, with quoted ("> ") lines removed. Pure and tested.
export function stripQuoted(text: string): string {
  const t = text.replace(/\r\n?/g, "\n");
  const cuts = [
    /\n[^\n]*\bOn\b[^\n]*(?:\n[^\n]*)?\bwrote:\s*\n/, // Gmail, Apple Mail (the line can wrap)
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{10,}\s*\n/, // Outlook's rule before its header block
    /\nFrom:\s[^\n]+\n(?:Sent|Date):\s/i,
    /\n-- \n/, // signature delimiter
  ];
  let end = t.length;
  for (const re of cuts) { const m = re.exec(`\n${t}`); if (m && m.index < end) end = Math.max(0, m.index); }
  return t.slice(0, end).split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type ReplyResult = { added: true; commentId: string; taskId: string; userId: string; fromClient: boolean } | { added: false; reason: string };

// Handles one received email that was sent to reply addresses. The first valid reply address decides the task and the person.
export async function receiveTaskReply(db: Db, p: { emailId: string; recipients: string[]; from: string; text: string }): Promise<ReplyResult> {
  const token = p.recipients.map((r) => TOKEN.exec(r.toLowerCase())?.[1]).find(Boolean);
  if (!token) return { added: false, reason: "not a reply address" };
  if (await db.taskComment.findUnique({ where: { sourceEmailId: p.emailId }, select: { id: true } })) return { added: false, reason: "already added" };
  const addr = await db.taskReplyAddress.findUnique({ where: { token }, select: { taskId: true, userId: true } });
  if (!addr) return { added: false, reason: "unknown reply address" };
  const user = await db.user.findFirst({ where: { id: addr.userId, active: true }, select: { id: true, organizationId: true, email: true, userType: true, clientId: true } });
  if (!user?.email || user.email.trim().toLowerCase() !== p.from.trim().toLowerCase()) return { added: false, reason: "sender does not match the person the address belongs to" };
  const task = await db.task.findFirst({
    where: { id: addr.taskId, project: { organizationId: user.organizationId } },
    select: { id: true, clientVisible: true, project: { select: { id: true, status: true, clientId: true, managerId: true, members: { where: { userId: user.id }, select: { userId: true } } } } },
  });
  if (!task) return { added: false, reason: "task not found" };
  const body = stripQuoted(p.text).slice(0, 4000).trim();
  if (!body) return { added: false, reason: "empty reply" };
  const fromClient = Boolean(user.clientId);
  if (fromClient) {
    if (!task.clientVisible || task.project.clientId !== user.clientId || task.project.status === "CANCELLED") return { added: false, reason: "task not shared with this client" };
  } else {
    if (user.userType !== "EMPLOYEE") return { added: false, reason: "not staff" };
    if (task.project.managerId !== user.id && task.project.members.length === 0) return { added: false, reason: "no longer on the project team" };
  }
  try {
    const c = await db.taskComment.create({ data: { taskId: task.id, authorId: user.id, body, internal: !fromClient, sourceEmailId: p.emailId } });
    await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: fromClient ? "portal.task_comment" : "task.comment", entity: "Task", entityId: task.id, after: { byEmail: true, commentId: c.id } } });
    return { added: true, commentId: c.id, taskId: task.id, userId: user.id, fromClient };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { added: false, reason: "already added" };
    throw e;
  }
}
