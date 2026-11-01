// Storage rules for mailbox conversations: threads, messages and who the other side is. Free of the mail transport so both
// the system sender (mailer.ts) and the mailbox screens (mailboxes.ts) can record what they send or receive the same way.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

export const MAILBOX_KINDS = ["SYSTEM", "SHARED", "PERSONAL"] as const;
export const SYSTEM_PURPOSES = ["NOREPLY", "BILLING", "HR", "ONBOARDING", "FINANCE"] as const;
export type SystemPurpose = (typeof SYSTEM_PURPOSES)[number];

// Which shared address sends each kind of system email. Anything not listed falls back to MAIL_FROM.
export const PURPOSE_FOR_RELATED: Record<string, SystemPurpose> = {
  INVOICE: "BILLING", QUOTE: "BILLING", STATEMENT: "BILLING",
  User: "NOREPLY", TEST: "NOREPLY", MEETING: "NOREPLY",
  INVITE: "ONBOARDING", JOB_APPLICATION: "HR", PAYSLIP: "HR",
};

export const lower = (a: string) => a.trim().toLowerCase();
export const domainOf = (address: string) => lower(address.split("@")[1] ?? "");

// "Name <a@b.c>" or "a@b.c" -> { address, name }
export function parseAddress(raw: string): { address: string; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { address: lower(m[2]), name: m[1].trim() || null };
  return { address: lower(raw), name: null };
}

// Mailbox "From" header. Display names are stripped of anything that could break the header.
export const fromHeader = (mb: { displayName: string; address: string }) => `${mb.displayName.replace(/[\r\n\0"<>]/g, "").trim() || mb.address} <${mb.address}>`;

export const newMessageId = (fromAddress: string) => `<${randomUUID()}@${domainOf(fromAddress) || "hifi.local"}>`;

// "Re: Fwd: RE: Invoice 12" -> "invoice 12", so replies without threading headers still join the conversation.
export const baseSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();

export const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 160);

// Who is on the other side: a client (by its email), a CRM contact (any of its emails) or an employee (their login email).
export async function identify(db: Db, organizationId: string, address: string) {
  const a = lower(address);
  const [client, contact, employee] = await Promise.all([
    db.client.findFirst({ where: { organizationId, email: { equals: a, mode: "insensitive" } }, select: { id: true } }),
    db.contact.findFirst({ where: { organizationId, OR: [{ primaryEmail: { equals: a, mode: "insensitive" } }, { matchKeys: { has: a } }] }, select: { id: true } }),
    db.user.findFirst({ where: { organizationId, userType: "EMPLOYEE", email: { equals: a, mode: "insensitive" } }, select: { id: true } }),
  ]);
  return { clientId: client?.id ?? null, contactId: contact?.id ?? null, employeeId: employee?.id ?? null };
}

// The thread a message belongs to: first by the Message-IDs it replies to, then by subject with the same counterpart
// in the last 60 days, else a new thread.
export async function findThread(db: Db, p: { mailboxId: string; counterpart: string; subject: string; inReplyTo?: string | null; references?: string[] }) {
  const ids = [...new Set([p.inReplyTo, ...(p.references ?? [])].filter(Boolean) as string[])];
  if (ids.length) {
    const hit = await db.mailMessage.findFirst({ where: { mailboxId: p.mailboxId, messageId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { threadId: true } });
    if (hit) return hit.threadId;
  }
  const base = baseSubject(p.subject);
  if (!base) return null;
  const recent = await db.mailThread.findMany({
    where: { mailboxId: p.mailboxId, counterpart: lower(p.counterpart), lastMessageAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
    orderBy: { lastMessageAt: "desc" }, take: 20, select: { id: true, subject: true },
  });
  return recent.find((t) => baseSubject(t.subject) === base)?.id ?? null;
}

export type StoredMessage = {
  organizationId: string; mailboxId: string; direction: "IN" | "OUT"; fromAddress: string; fromName?: string | null;
  to: string[]; cc?: string[]; subject: string; text: string; html?: string | null; messageId?: string | null; inReplyTo?: string | null;
  references?: string[]; attachmentNames?: string[]; status: string; error?: string | null; providerId?: string | null; sentById?: string | null;
  relatedType?: string | null; relatedId?: string | null; threadId?: string | null; at?: Date;
};

// Saves one message and keeps its thread's summary (subject, snippet, unread count, last activity) in step.
export async function storeMessage(db: Db, m: StoredMessage) {
  const counterpart = lower(m.direction === "IN" ? m.fromAddress : m.to[0] ?? "");
  const at = m.at ?? new Date();
  let threadId = m.threadId ?? (await findThread(db, { mailboxId: m.mailboxId, counterpart, subject: m.subject, inReplyTo: m.inReplyTo, references: m.references }));
  if (!threadId) {
    const who = await identify(db, m.organizationId, counterpart);
    threadId = (await db.mailThread.create({
      data: { organizationId: m.organizationId, mailboxId: m.mailboxId, subject: m.subject.slice(0, 200) || "(no subject)", counterpart, ...who, lastMessageAt: at },
    })).id;
  }
  return db.$transaction(async (tx) => {
    const msg = await tx.mailMessage.create({
      data: {
        organizationId: m.organizationId, mailboxId: m.mailboxId, threadId: threadId!, direction: m.direction, fromAddress: lower(m.fromAddress), fromName: m.fromName ?? null,
        toAddresses: m.to.map(lower), ccAddresses: (m.cc ?? []).map(lower), subject: m.subject.slice(0, 200), text: m.text, html: m.html ?? null,
        messageId: m.messageId ?? null, inReplyTo: m.inReplyTo ?? null, references: m.references ?? [], attachmentNames: m.attachmentNames ?? [],
        status: m.status, error: m.error ?? null, providerId: m.providerId ?? null, sentById: m.sentById ?? null,
        relatedType: m.relatedType ?? null, relatedId: m.relatedId ?? null, createdAt: at,
      },
    });
    await tx.mailThread.update({
      where: { id: threadId! },
      data: { lastMessageAt: at, snippet: snippetOf(m.text), status: "OPEN", ...(m.direction === "IN" ? { unread: { increment: 1 } } : {}) },
    });
    return msg;
  });
}
