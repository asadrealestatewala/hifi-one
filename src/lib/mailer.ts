// Outgoing email over SMTP (works with Gmail/Google Workspace app passwords, Microsoft 365, SendGrid, Mailgun, Amazon SES SMTP
// and any other SMTP provider). Credentials come from environment variables, never from the database or the screen.
// Honesty rules: with no mail account configured nothing is sent and the log says NOT_CONFIGURED; a message is SENT only
// when the mail server accepted it; failures are logged with the reason and never thrown at the person clicking.
import type { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

type Db = PrismaClient;
export class MailError extends Error {}

export type Attachment = { filename: string; content: Buffer; contentType: string };
export type Outgoing = { from: string; to: string; subject: string; text: string; attachments?: Attachment[] };
export type Transport = { send(m: Outgoing): Promise<{ messageId?: string }>; verify(): Promise<void> };

export function mailConfig(env: Record<string, string | undefined> = process.env) {
  const host = env.SMTP_HOST?.trim();
  const from = env.MAIL_FROM?.trim();
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    configured: Boolean(host && from),
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

function realTransport(): Transport | null {
  const c = mailConfig();
  if (!c.configured) return null;
  const t = nodemailer.createTransport({
    host: c.host!, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return {
    async send(m) { const r = await t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, attachments: m.attachments }); return { messageId: r.messageId }; },
    async verify() { await t.verify(); },
  };
}
const transport = (): Transport | null => override ?? realTransport();
export const isConfigured = () => override !== null || mailConfig().configured;

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
  const t = transport();
  if (!t) return db.emailMessage.create({ data: { ...base, status: "NOT_CONFIGURED", error: "No mail account is connected. Nothing was sent." } });
  const from = override ? "test@example.invalid" : mailConfig().from!;
  try {
    const r = await t.send({ from, to, subject, text: p.text, attachments: p.attachment ? [p.attachment] : undefined });
    return db.emailMessage.create({ data: { ...base, status: "SENT", providerMessageId: r.messageId ?? null, sentAt: new Date() } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return db.emailMessage.create({ data: { ...base, status: "FAILED", error: msg.slice(0, 500) } });
  }
}

export async function verifyMail(): Promise<{ ok: boolean; message: string }> {
  const t = transport();
  if (!t) return { ok: false, message: "No mail account is connected. Set SMTP_HOST and MAIL_FROM (and SMTP_USER and SMTP_PASS if your provider needs them), then restart." };
  try {
    await t.verify();
    return { ok: true, message: "The mail server accepted the connection and sign-in." };
  } catch (e) {
    return { ok: false, message: `Could not connect: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}
