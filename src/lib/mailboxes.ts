// Company mailboxes: shared system addresses (noreply, billing, hr, onboarding, finance), team mailboxes and one or more
// personal mailboxes per employee. Access is by membership: each member signs in with their own Hifi One login, and nobody,
// administrators included, reads a mailbox they are not a member of. Outgoing mail goes through the configured transport
// (Resend API or SMTP); incoming mail arrives through the Resend "email.received" webhook (see receiveInbound).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { MailError, cleanAddress, transport } from "./mailer";
import { SYSTEM_PURPOSES, type SystemPurpose, fromHeader, lower, newMessageId, parseAddress, storeMessage } from "./mail-store";
import { notifyMany } from "./notifications";
import { stopForReply } from "./followups";

type Db = PrismaClient;

// Shared and system addresses (billing@, sales@, noreply@ ...) live here: the public company domain.
export function mailDomain(env: Record<string, string | undefined> = process.env) {
  return lower(env.MAIL_DOMAIN || "hifimarketing.co");
}

// Personal (employee) addresses live here. Defaults to MAIL_DOMAIN. Set STAFF_MAIL_DOMAIN (for example mail.hifimarketing.co)
// when the receiving domain at Resend is a subdomain, so a new employee mailbox works the moment it is created, with no
// forwarding rule to add at the DNS host. The public domain then only needs forwards for its few shared addresses.
export function staffMailDomain(env: Record<string, string | undefined> = process.env) {
  return lower(env.STAFF_MAIL_DOMAIN || env.MAIL_DOMAIN || "hifimarketing.co");
}

export function receivingConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  const secret = env.RESEND_WEBHOOK_SECRET?.trim() || null;
  return { configured: Boolean(apiKey && secret), apiKey, secret };
}

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
export function cleanLocalPart(raw: string): string {
  const v = lower(raw).replace(/@.*$/, "");
  if (!LOCAL_PART.test(v) || v.includes("..")) throw new MailError("Use letters, numbers, dots, dashes or underscores for the address (for example sara.khan).");
  return v;
}
const cleanName = (raw: string, fallback: string) => raw.replace(/[\r\n\0"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;

export const STANDARD_MAILBOXES: { purpose: SystemPurpose; local: string; label: string }[] = [
  { purpose: "NOREPLY", local: "noreply", label: "" },
  { purpose: "BILLING", local: "billing", label: "Billing" },
  { purpose: "HR", local: "hr", label: "HR" },
  { purpose: "ONBOARDING", local: "onboarding", label: "Onboarding" },
  { purpose: "FINANCE", local: "finance", label: "Finance" },
];

export async function createMailbox(db: Db, p: {
  organizationId: string; actorId: string; localPart: string; displayName: string; kind: "SYSTEM" | "SHARED" | "PERSONAL";
  purpose?: SystemPurpose | null; ownerId?: string | null; domain?: string;
}) {
  const local = cleanLocalPart(p.localPart);
  const address = `${local}@${p.domain ?? (p.kind === "PERSONAL" ? staffMailDomain() : mailDomain())}`;
  if (p.kind === "SYSTEM" && !(p.purpose && SYSTEM_PURPOSES.includes(p.purpose))) throw new MailError("Choose what the system mailbox is for.");
  if (p.kind !== "SYSTEM" && p.purpose) throw new MailError("Only system mailboxes have a purpose.");
  let owner: { id: string; name: string } | null = null;
  if (p.kind === "PERSONAL") {
    if (!p.ownerId) throw new MailError("Choose the employee this mailbox belongs to.");
    owner = await db.user.findFirst({ where: { id: p.ownerId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true } });
    if (!owner) throw new MailError("That employee was not found or is inactive.");
  }
  if (await db.mailbox.findUnique({ where: { address } })) throw new MailError(`${address} already exists.`);
  if (p.purpose && (await db.mailbox.findFirst({ where: { organizationId: p.organizationId, purpose: p.purpose } }))) throw new MailError(`There is already a ${p.purpose.toLowerCase()} mailbox.`);
  return db.mailbox.create({
    data: {
      organizationId: p.organizationId, address, kind: p.kind, purpose: p.kind === "SYSTEM" ? p.purpose! : null, ownerId: owner?.id ?? null,
      displayName: cleanName(p.displayName, owner?.name ?? address), createdById: p.actorId,
      ...(owner ? { members: { create: { userId: owner.id, canSend: true } } } : {}),
    },
  });
}

// Creates whichever of noreply, billing, hr, onboarding and finance are missing. Safe to run again.
export async function setupStandardMailboxes(db: Db, p: { organizationId: string; actorId: string; companyName: string }) {
  const made: string[] = [];
  for (const s of STANDARD_MAILBOXES) {
    if (await db.mailbox.findFirst({ where: { organizationId: p.organizationId, purpose: s.purpose } })) continue;
    const address = `${s.local}@${mailDomain()}`;
    if (await db.mailbox.findUnique({ where: { address } })) continue;
    await createMailbox(db, { organizationId: p.organizationId, actorId: p.actorId, localPart: s.local, kind: "SYSTEM", purpose: s.purpose, displayName: s.label ? `${p.companyName} ${s.label}` : p.companyName });
    made.push(address);
  }
  return made;
}

export async function addMember(db: Db, p: { organizationId: string; mailboxId: string; userId: string; canSend: boolean }) {
  const [mb, user] = await Promise.all([
    db.mailbox.findFirst({ where: { id: p.mailboxId, organizationId: p.organizationId } }),
    db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true } }),
  ]);
  if (!mb) throw new MailError("Mailbox not found.");
  if (!user) throw new MailError("That employee was not found or is inactive.");
  return db.mailboxMember.upsert({ where: { mailboxId_userId: { mailboxId: mb.id, userId: user.id } }, create: { mailboxId: mb.id, userId: user.id, canSend: p.canSend }, update: { canSend: p.canSend } });
}

export async function removeMember(db: Db, p: { organizationId: string; mailboxId: string; userId: string }) {
  const mb = await db.mailbox.findFirst({ where: { id: p.mailboxId, organizationId: p.organizationId } });
  if (!mb) throw new MailError("Mailbox not found.");
  if (mb.kind === "PERSONAL" && mb.ownerId === p.userId) throw new MailError("The owner of a personal mailbox cannot be removed. Deactivate the mailbox instead.");
  await db.mailboxMember.deleteMany({ where: { mailboxId: mb.id, userId: p.userId } });
}

export async function updateMailbox(db: Db, p: { organizationId: string; mailboxId: string; displayName?: string; signature?: string | null; active?: boolean }) {
  const mb = await db.mailbox.findFirst({ where: { id: p.mailboxId, organizationId: p.organizationId } });
  if (!mb) throw new MailError("Mailbox not found.");
  return db.mailbox.update({
    where: { id: mb.id },
    data: {
      ...(p.displayName !== undefined ? { displayName: cleanName(p.displayName, mb.displayName) } : {}),
      ...(p.signature !== undefined ? { signature: p.signature?.trim().slice(0, 1000) || null } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    },
  });
}

// ---------- Using a mailbox ----------

export const myMailboxes = (db: Db, user: { id: string; organizationId: string }) =>
  db.mailbox.findMany({ where: { organizationId: user.organizationId, active: true, members: { some: { userId: user.id } } }, orderBy: [{ kind: "desc" }, { address: "asc" }], include: { members: { where: { userId: user.id } } } });

// The mailbox, if this person is a member of it (and may send from it, when asked).
export async function mailboxFor(db: Db, user: { id: string; organizationId: string }, mailboxId: string, opts: { send?: boolean } = {}) {
  const mb = await db.mailbox.findFirst({ where: { id: mailboxId, organizationId: user.organizationId, active: true, members: { some: { userId: user.id, ...(opts.send ? { canSend: true } : {}) } } } });
  return mb;
}

export async function threadFor(db: Db, user: { id: string; organizationId: string }, threadId: string) {
  const t = await db.mailThread.findFirst({ where: { id: threadId, organizationId: user.organizationId }, include: { mailbox: true } });
  if (!t || !(await mailboxFor(db, user, t.mailboxId))) return null;
  return t;
}

export const USER_HOURLY_LIMIT = 100;
const MAX_CC = 10;

function addressList(raw: string): string[] {
  const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > MAX_CC) throw new MailError(`Add at most ${MAX_CC} addresses in copy.`);
  return [...new Set(parts.map((a) => lower(cleanAddress(a))))];
}

// Compose or reply from a mailbox. The message is recorded in the thread whatever happens, with the honest result.
export async function sendFromMailbox(db: Db, p: {
  user: { id: string; organizationId: string; name: string }; mailboxId: string; to: string; cc?: string; subject: string; text: string; threadId?: string | null; now?: Date;
}) {
  const mb = await mailboxFor(db, p.user, p.mailboxId, { send: true });
  if (!mb) throw new MailError("You cannot send from that mailbox.");
  const thread = p.threadId ? await db.mailThread.findFirst({ where: { id: p.threadId, mailboxId: mb.id } }) : null;
  if (p.threadId && !thread) throw new MailError("Conversation not found.");
  const to = lower(cleanAddress(p.to));
  const cc = p.cc ? addressList(p.cc).filter((a) => a !== to) : [];
  const subject = p.subject.replace(/[\r\n\0]+/g, " ").trim().slice(0, 200);
  if (!subject) throw new MailError("The email needs a subject.");
  const body = p.text.trim();
  if (!body) throw new MailError("Write a message.");
  if (body.length > 50_000) throw new MailError("The message is too long.");
  const since = new Date((p.now ?? new Date()).getTime() - 3_600_000);
  if ((await db.mailMessage.count({ where: { sentById: p.user.id, direction: "OUT", createdAt: { gte: since } } })) >= USER_HOURLY_LIMIT) {
    throw new MailError(`You have reached the limit of ${USER_HOURLY_LIMIT} emails per hour. Try again later.`);
  }
  // Reply headers: the latest message in the conversation and the chain before it.
  const last = thread ? await db.mailMessage.findFirst({ where: { threadId: thread.id, messageId: { not: null } }, orderBy: { createdAt: "desc" } }) : null;
  const inReplyTo = last?.messageId ?? undefined;
  const references = last ? [...last.references, last.messageId!].slice(-20) : [];
  const text = mb.signature ? `${body}\n\n-- \n${mb.signature}` : body;
  const messageId = newMessageId(mb.address);
  const base = {
    organizationId: mb.organizationId, mailboxId: mb.id, direction: "OUT" as const, fromAddress: mb.address, fromName: mb.displayName, to: [to], cc, subject, text,
    messageId, inReplyTo: inReplyTo ?? null, references, sentById: p.user.id, threadId: thread?.id ?? null,
  };
  const t = transport();
  if (!t) return storeMessage(db, { ...base, status: "NOT_CONFIGURED", error: "No mail account is connected. Nothing was sent." });
  try {
    const r = await t.send({ from: fromHeader(mb), to, cc, subject, text, messageId, inReplyTo, references });
    return storeMessage(db, { ...base, status: "SENT", providerId: r.messageId ?? null });
  } catch (e) {
    return storeMessage(db, { ...base, status: "FAILED", error: (e instanceof Error ? e.message : "Unknown error").slice(0, 500) });
  }
}

export async function markThread(db: Db, user: { id: string; organizationId: string }, threadId: string, op: "read" | "unread" | "archive" | "unarchive") {
  const t = await threadFor(db, user, threadId);
  if (!t) throw new MailError("Conversation not found.");
  const data = op === "read" ? { unread: 0 } : op === "unread" ? { unread: Math.max(1, t.unread) } : op === "archive" ? { status: "ARCHIVED" } : { status: "OPEN" };
  return db.mailThread.update({ where: { id: t.id }, data });
}

// ---------- Receiving (Resend inbound webhook) ----------

// Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_".
export function verifyWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${body}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export type ReceivedEmail = {
  id: string; from: string; to: string[]; cc?: string[] | null; received_for?: string[] | null; subject?: string | null; text?: string | null; html?: string | null;
  message_id?: string | null; headers?: Record<string, string> | null; attachments?: { filename?: string | null }[] | null; created_at?: string;
};
export type FetchReceived = (emailId: string) => Promise<ReceivedEmail>;

export function resendFetcher(apiKey: string): FetchReceived {
  return async (emailId) => {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Resend ${res.status} while fetching a received email`);
    return (await res.json()) as ReceivedEmail;
  };
}

const htmlToText = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
const header = (h: Record<string, string> | null | undefined, name: string) => {
  if (!h) return null;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k ? String(h[k]) : null;
};
const ids = (v: string | null) => (v ? v.match(/<[^<>\s]+>/g) ?? [] : []);

// Files one received email into every active mailbox it was addressed to, and tells the members.
// Emails for addresses nobody has a mailbox for are ignored. Retries of the same webhook store nothing new.
export async function receiveInbound(db: Db, event: { type?: string; data?: { email_id?: string } }, fetchEmail: FetchReceived) {
  if (event.type !== "email.received" || !event.data?.email_id) return { stored: 0, ignored: "not an email.received event" };
  const emailId = event.data.email_id;
  const e = await fetchEmail(emailId);
  const recipients = [...new Set([...(e.to ?? []), ...(e.cc ?? []), ...(e.received_for ?? [])].map((a) => parseAddress(a).address))];
  const mailboxes = await db.mailbox.findMany({ where: { address: { in: recipients }, active: true }, include: { members: { select: { userId: true } } } });
  if (!mailboxes.length) return { stored: 0, ignored: "no mailbox for these addresses" };
  const from = parseAddress(e.from);
  const text = (e.text?.trim() || (e.html ? htmlToText(e.html) : "")).slice(0, 100_000);
  const subject = (e.subject ?? "").replace(/[\r\n\0]+/g, " ").trim().slice(0, 200) || "(no subject)";
  let stored = 0;
  for (const mb of mailboxes) {
    const providerId = `in:${emailId}:${mb.id}`;
    if (await db.mailMessage.findUnique({ where: { providerId } })) continue;
    const msg = await storeMessage(db, {
      organizationId: mb.organizationId, mailboxId: mb.id, direction: "IN", fromAddress: from.address, fromName: from.name, to: (e.to ?? []).map((a) => parseAddress(a).address),
      cc: (e.cc ?? []).map((a) => parseAddress(a).address), subject, text, html: e.html ? e.html.slice(0, 500_000) : null,
      messageId: e.message_id ?? header(e.headers, "message-id"), inReplyTo: ids(header(e.headers, "in-reply-to"))[0] ?? null, references: ids(header(e.headers, "references")).slice(-20),
      attachmentNames: (e.attachments ?? []).map((a) => a.filename ?? "attachment").slice(0, 50), status: "RECEIVED", providerId,
      at: e.created_at && !Number.isNaN(Date.parse(e.created_at)) ? new Date(e.created_at) : undefined,
    });
    stored++;
    // A reply from a lead ends any follow-up sequence still emailing them
    await stopForReply(db, { organizationId: mb.organizationId, from: from.address, threadId: msg.threadId });
    await notifyMany(db, mb.members.map((m) => m.userId), { kind: "mail", title: `New email in ${mb.address}`, body: `${from.name ?? from.address}: ${subject}`, link: `/mail/${msg.threadId}`, dedupeKey: `mail:${providerId}` });
  }
  return { stored };
}
