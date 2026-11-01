// Outgoing email through the Resend API (RESEND_API_KEY) or over SMTP (works with Resend SMTP, Gmail/Google Workspace app passwords,
// Microsoft 365, SendGrid, Mailgun, Amazon SES SMTP and any other SMTP provider). When both are set, the Resend API is used.
// Credentials come from environment variables, never from the database or the screen.
// Honesty rules: with no mail account configured nothing is sent and the log says NOT_CONFIGURED; a message is SENT only
// when the mail server accepted it; failures are logged with the reason and never thrown at the person clicking.
import type { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { PURPOSE_FOR_RELATED, fromHeader, newMessageId, storeMessage, type SystemPurpose } from "./mail-store";

type Db = PrismaClient;
export class MailError extends Error {}

export type Attachment = { filename: string; content: Buffer; contentType: string };
export type Outgoing = {
  from: string; to: string; subject: string; text: string; attachments?: Attachment[];
  cc?: string[]; replyTo?: string; messageId?: string; inReplyTo?: string; references?: string[];
};
export type Transport = { send(m: Outgoing): Promise<{ messageId?: string }>; verify(): Promise<void> };

export function mailConfig(env: Record<string, string | undefined> = process.env) {
  const host = env.SMTP_HOST?.trim();
  const from = env.MAIL_FROM?.trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const resendKey = env.RESEND_API_KEY?.trim() || null;
  return {
    // A way to send exists (the Resend API or an SMTP server). Mailboxes only need this; their own address is the sender.
    transportReady: Boolean(resendKey || host),
    // Sending also has a default sender for messages that no mailbox owns.
    configured: Boolean((resendKey || host) && from),
    provider: resendKey ? ("RESEND_API" as const) : host ? ("SMTP" as const) : null,
    resendKey,
    host: host ?? null,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS || null,
    from: from ?? null,
  };
}

let override: Transport | null = null;
export function setTransportForTests(t: Transport | null) { override = t; }

const RESEND_API = "https://api.resend.com";

function resendTransport(key: string): Transport {
  return {
    async send(m) {
      const headers: Record<string, string> = {};
      if (m.messageId) headers["Message-ID"] = m.messageId;
      if (m.inReplyTo) headers["In-Reply-To"] = m.inReplyTo;
      if (m.references?.length) headers["References"] = m.references.join(" ");
      const res = await fetch(`${RESEND_API}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: m.from, to: [m.to], cc: m.cc?.length ? m.cc : undefined, reply_to: m.replyTo, subject: m.subject, text: m.text,
          headers: Object.keys(headers).length ? headers : undefined,
          attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? res.statusText}`);
      return { messageId: body.id };
    },
    async verify() {
      const res = await fetch(`${RESEND_API}/domains`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
      // A sending-only key cannot list domains but is valid for sending. Receiving needs a full-access key.
      if (res.status === 401 && body.name === "restricted_api_key") return;
      throw new Error(`Resend ${res.status}: ${body.message ?? res.statusText}`);
    },
  };
}

function realTransport(): Transport | null {
  const c = mailConfig();
  if (!c.transportReady) return null;
  if (c.resendKey) return resendTransport(c.resendKey);
  const t = nodemailer.createTransport({
    host: c.host!, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return {
    async send(m) {
      const r = await t.sendMail({
        from: m.from, to: m.to, cc: m.cc, replyTo: m.replyTo, subject: m.subject, text: m.text, attachments: m.attachments,
        messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references,
      });
      return { messageId: r.messageId };
    },
    async verify() { await t.verify(); },
  };
}
export const transport = (): Transport | null => override ?? realTransport();
export const isConfigured = () => override !== null || mailConfig().configured;
export const canSend = () => override !== null || mailConfig().transportReady;

// A recipient must look like one address. Control characters are rejected outright so a value can never add headers.
export function cleanAddress(raw: string): string {
  const a = raw.trim();
  if (a.length > 254 || /[\r\n\0<>,;"\s]/.test(a) || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(a)) throw new MailError("Enter one valid email address.");
  return a;
}
const oneLine = (s: string) => s.replace(/[\r\n\0]+/g, " ").trim();

export const HOURLY_LIMIT = 60;

export async function sendEmail(db: Db, p: {
  organizationId: string; to: string; subject: string; text: string; attachment?: Attachment; relatedType?: string; relatedId?: string; actorId?: string; now?: Date;
  storedText?: string; // what the outbox keeps instead of `text`, for messages that carry a secret link
  purpose?: SystemPurpose; // which shared mailbox sends it; defaults from relatedType (invoices from billing@, resets from noreply@)
}) {
  const to = cleanAddress(p.to);
  const subject = oneLine(p.subject).slice(0, 200);
  if (!subject) throw new MailError("The email needs a subject.");
  if (p.text.length > 20_000) throw new MailError("The message is too long.");
  const since = new Date((p.now ?? new Date()).getTime() - 3_600_000);
  if ((await db.emailMessage.count({ where: { organizationId: p.organizationId, createdAt: { gte: since } } })) >= HOURLY_LIMIT) {
    throw new MailError(`Email limit reached (${HOURLY_LIMIT} per hour). Try again later.`);
  }
  const base = { organizationId: p.organizationId, toEmail: to, subject, body: p.storedText ?? p.text, attachmentName: p.attachment?.filename ?? null, relatedType: p.relatedType ?? null, relatedId: p.relatedId ?? null, createdById: p.actorId ?? null };
  // The shared system mailbox for this kind of message, when an administrator has set one up (Settings > Mailboxes).
  const purpose = p.purpose ?? (p.relatedType ? PURPOSE_FOR_RELATED[p.relatedType] : undefined);
  const mailbox = purpose ? await db.mailbox.findFirst({ where: { organizationId: p.organizationId, purpose, active: true } }) : null;
  const t = transport();
  const from = mailbox ? fromHeader(mailbox) : override ? "test@example.invalid" : mailConfig().from;
  // Keep a copy in the mailbox's Sent folder so replies thread back into the same conversation.
  const keep = async (status: string, extra: { providerId?: string | null; error?: string | null; messageId?: string }) => {
    if (!mailbox) return;
    await storeMessage(db, {
      organizationId: p.organizationId, mailboxId: mailbox.id, direction: "OUT", fromAddress: mailbox.address, fromName: mailbox.displayName, to: [to], subject, text: p.storedText ?? p.text,
      attachmentNames: p.attachment ? [p.attachment.filename] : [], status, sentById: p.actorId ?? null, relatedType: p.relatedType ?? null, relatedId: p.relatedId ?? null, ...extra,
    });
  };
  if (!t || !from) {
    await keep("NOT_CONFIGURED", { error: "No mail account is connected. Nothing was sent." });
    return db.emailMessage.create({ data: { ...base, status: "NOT_CONFIGURED", error: "No mail account is connected. Nothing was sent." } });
  }
  const messageId = mailbox ? newMessageId(mailbox.address) : undefined;
  let r: { messageId?: string };
  try {
    r = await t.send({ from, to, subject, text: p.text, attachments: p.attachment ? [p.attachment] : undefined, messageId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await keep("FAILED", { error: msg.slice(0, 500), messageId });
    return db.emailMessage.create({ data: { ...base, status: "FAILED", error: msg.slice(0, 500) } });
  }
  const logged = await db.emailMessage.create({ data: { ...base, status: "SENT", providerMessageId: r.messageId ?? null, sentAt: new Date() } });
  await keep("SENT", { providerId: r.messageId ?? null, messageId });
  return logged;
}

export async function verifyMail(): Promise<{ ok: boolean; message: string }> {
  const t = transport();
  if (!t) return { ok: false, message: "No mail account is connected. Set RESEND_API_KEY (or SMTP_HOST, plus SMTP_USER and SMTP_PASS if your provider needs them) and MAIL_FROM, then restart." };
  try {
    await t.verify();
    return { ok: true, message: mailConfig().provider === "RESEND_API" ? "Resend accepted the API key." : "The mail server accepted the connection and sign-in." };
  } catch (e) {
    return { ok: false, message: `Could not connect: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}
