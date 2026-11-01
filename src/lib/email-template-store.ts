// Stored templates and sending with them. Built-in templates use the wording in email-templates.ts until someone edits them
// (then a row with the same key holds the edited copy; "reset" deletes the row). Follow-up templates live only in the database.
// Every send goes through sendEmail, so the outbox log, the mailbox Sent folder, rate limits and the "not configured" honesty
// rules apply exactly as for any other system email.
import type { PrismaClient } from "@prisma/client";
import { MailError, sendEmail, type Attachment } from "./mailer";
import type { SystemPurpose } from "./mail-store";
import {
  FOLLOW_UP_VARIABLES, STARTER_FOLLOW_UPS, TEMPLATE_LIMITS, fillUrl, renderEmail, safeUrl, systemTemplate, variablesIn,
  type Brand, type TemplateContent,
} from "./email-templates";

type Db = PrismaClient;

export const appUrl = (env: Record<string, string | undefined> = process.env) => (env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

export async function brandFor(db: Db, organizationId: string): Promise<Brand> {
  const [p, org] = await Promise.all([
    db.companyProfile.findFirst({ where: { organizationId, isDefault: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);
  return {
    company: p?.tradingName || p?.legalName || org?.name || "Hifi Marketing and Technologies",
    appUrl: appUrl(),
    address: p?.registeredOffice || p?.salesCentre || null,
    phone: p?.globalUan || p?.localUan || null,
    email: p?.email || null,
    website: p?.website || null,
  };
}

const rowContent = (r: { subject: string; preheader: string | null; heading: string; body: string; buttonLabel: string | null; buttonUrl: string | null; highlights: string | null }): TemplateContent =>
  ({ subject: r.subject, preheader: r.preheader, heading: r.heading, body: r.body, buttonLabel: r.buttonLabel, buttonUrl: r.buttonUrl, highlights: r.highlights });

// The wording a built-in email uses now: the edited copy if there is one, else the default.
export async function systemContent(db: Db, organizationId: string, key: string) {
  const def = systemTemplate(key);
  if (!def) throw new MailError("Unknown email template.");
  const row = await db.emailTemplate.findUnique({ where: { organizationId_key: { organizationId, key } } });
  return { def, content: row && row.kind === "SYSTEM" ? { ...rowContent(row), buttonUrl: null } : def.defaults, edited: Boolean(row) };
}

const clip = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length > max) throw new MailError(`Keep it under ${max} characters.`);
  return t;
};

// Checks and tidies what someone typed in the editor. Built-in templates may only use their own variables, so a typo shows
// up here instead of as a blank in a real email.
export function cleanContent(input: TemplateContent, allowed: string[], opts: { buttonUrl: boolean }): TemplateContent {
  const c: TemplateContent = {
    subject: clip(input.subject, TEMPLATE_LIMITS.subject).replace(/\s*\n\s*/g, " "),
    preheader: clip(input.preheader, TEMPLATE_LIMITS.preheader).replace(/\s*\n\s*/g, " ") || null,
    heading: clip(input.heading, TEMPLATE_LIMITS.heading).replace(/\s*\n\s*/g, " "),
    body: clip(input.body, TEMPLATE_LIMITS.body),
    buttonLabel: clip(input.buttonLabel, TEMPLATE_LIMITS.buttonLabel) || null,
    buttonUrl: opts.buttonUrl ? clip(input.buttonUrl, TEMPLATE_LIMITS.buttonUrl) || null : null,
    highlights: clip(input.highlights, TEMPLATE_LIMITS.highlights) || null,
  };
  if (!c.subject) throw new MailError("The email needs a subject.");
  if (!c.heading) throw new MailError("The email needs a heading.");
  if (!c.body) throw new MailError("Write the message.");
  const used = variablesIn([c.subject, c.preheader, c.heading, c.body, c.buttonLabel, c.buttonUrl, c.highlights].filter(Boolean).join("\n"));
  const unknown = used.filter((v) => !allowed.includes(v));
  if (unknown.length) throw new MailError(`Unknown variable${unknown.length === 1 ? "" : "s"}: ${unknown.map((v) => `{{${v}}}`).join(", ")}. Use only the ones listed next to the editor.`);
  if (c.buttonUrl) {
    const sample = Object.fromEntries(allowed.map((k) => [k, FOLLOW_UP_VARIABLES[k] ?? "x"]));
    if (!safeUrl(fillUrl(c.buttonUrl, sample))) throw new MailError("The button link must start with https://, http:// or mailto:.");
    if (!c.buttonLabel) throw new MailError("Give the button a label, or clear its link.");
  }
  return c;
}

export async function saveSystemTemplate(db: Db, p: { organizationId: string; key: string; content: TemplateContent; actorId: string }) {
  const def = systemTemplate(p.key);
  if (!def) throw new MailError("Unknown email template.");
  const c = cleanContent(p.content, [...Object.keys(def.variables), "company_name"], { buttonUrl: false });
  const data = { subject: c.subject, preheader: c.preheader ?? null, heading: c.heading, body: c.body, buttonLabel: c.buttonLabel ?? null, buttonUrl: null, highlights: c.highlights ?? null, updatedById: p.actorId };
  return db.emailTemplate.upsert({
    where: { organizationId_key: { organizationId: p.organizationId, key: p.key } },
    create: { organizationId: p.organizationId, key: p.key, kind: "SYSTEM", name: def.name, ...data },
    update: data,
  });
}

export async function resetSystemTemplate(db: Db, p: { organizationId: string; key: string }) {
  if (!systemTemplate(p.key)) throw new MailError("Unknown email template.");
  await db.emailTemplate.deleteMany({ where: { organizationId: p.organizationId, key: p.key, kind: "SYSTEM" } });
}

// ---------- follow-up templates ----------

export const FOLLOW_UP_VARS = Object.keys(FOLLOW_UP_VARIABLES);

const slug = (name: string) => `followup_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "email"}`;

export async function saveFollowUpTemplate(db: Db, p: { organizationId: string; id?: string | null; name: string; content: TemplateContent; actorId: string }) {
  const name = p.name.replace(/\s+/g, " ").trim().slice(0, TEMPLATE_LIMITS.name);
  if (name.length < 2) throw new MailError("Name the template.");
  const c = cleanContent(p.content, FOLLOW_UP_VARS, { buttonUrl: true });
  const data = { name, subject: c.subject, preheader: c.preheader ?? null, heading: c.heading, body: c.body, buttonLabel: c.buttonLabel ?? null, buttonUrl: c.buttonUrl ?? null, highlights: c.highlights ?? null, updatedById: p.actorId };
  if (p.id) {
    const t = await db.emailTemplate.findFirst({ where: { id: p.id, organizationId: p.organizationId, kind: "FOLLOW_UP" } });
    if (!t) throw new MailError("Template not found.");
    return db.emailTemplate.update({ where: { id: t.id }, data });
  }
  let key = slug(name);
  for (let n = 2; await db.emailTemplate.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key } } }); n++) key = `${slug(name)}_${n}`;
  return db.emailTemplate.create({ data: { organizationId: p.organizationId, key, kind: "FOLLOW_UP", ...data } });
}

export async function setFollowUpTemplateArchived(db: Db, p: { organizationId: string; id: string; archived: boolean }) {
  const t = await db.emailTemplate.findFirst({ where: { id: p.id, organizationId: p.organizationId, kind: "FOLLOW_UP" } });
  if (!t) throw new MailError("Template not found.");
  if (p.archived) {
    const used = await db.followUpStep.count({ where: { templateId: t.id, sequence: { active: true } } });
    if (used) throw new MailError("A running sequence still uses this template. Remove it from the sequence first.");
  }
  return db.emailTemplate.update({ where: { id: t.id }, data: { archived: p.archived } });
}

// The four starter emails (day 0, 2, 5, 10). Existing ones are kept, so this is safe to run again.
export async function ensureStarterTemplates(db: Db, p: { organizationId: string; actorId: string }) {
  const out: { id: string; delayDays: number }[] = [];
  for (const s of STARTER_FOLLOW_UPS) {
    const found = await db.emailTemplate.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key: s.key } } });
    const t = found ?? (await db.emailTemplate.create({
      data: { organizationId: p.organizationId, key: s.key, kind: "FOLLOW_UP", name: s.name, subject: s.content.subject, preheader: s.content.preheader ?? null, heading: s.content.heading, body: s.content.body, buttonLabel: s.content.buttonLabel ?? null, buttonUrl: s.content.buttonUrl ?? null, highlights: s.content.highlights ?? null, updatedById: p.actorId },
    }));
    out.push({ id: t.id, delayDays: s.delayDays });
  }
  return out;
}

// ---------- sending ----------

export type SendTemplateInput = {
  organizationId: string; key: string; to: string; vars: Record<string, string | null | undefined>; buttonUrl?: string | null;
  relatedType?: string; relatedId?: string; actorId?: string; purpose?: SystemPurpose; mailboxId?: string | null;
  attachment?: Attachment; secret?: boolean; // secret: the outbox keeps the message without its code and link
};

// Renders a built-in template with the company's branding and sends it. Never throws for delivery problems (sendEmail logs them).
export async function sendTemplate(db: Db, p: SendTemplateInput) {
  const [{ def, content }, brand] = await Promise.all([systemContent(db, p.organizationId, p.key), brandFor(db, p.organizationId)]);
  const vars = { company_name: brand.company, ...p.vars };
  const r = renderEmail({ content, vars, brand, blocks: def.blocks, buttonUrl: p.buttonUrl ?? null });
  return sendEmail(db, {
    organizationId: p.organizationId, to: p.to, subject: r.subject, text: r.text, html: r.html, relatedType: p.relatedType, relatedId: p.relatedId, actorId: p.actorId,
    purpose: p.purpose, mailboxId: p.mailboxId, attachment: p.attachment,
    storedText: p.secret ? `${r.subject}\n\n[This message contained a one-time code or link, which is not kept.]` : undefined,
  });
}

// The same, for notices that must never interrupt the work that triggered them (task or lead assigned): any problem is logged.
export async function sendTemplateQuietly(db: Db, p: SendTemplateInput) {
  try {
    return await sendTemplate(db, p);
  } catch (e) {
    console.error(`Email "${p.key}" was not sent:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
