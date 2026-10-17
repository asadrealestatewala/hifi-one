// Agreements with electronic signature. A template with {{placeholders}} becomes an agreement for one client or vendor; when it is sent,
// its text is frozen and hashed, and a one-time link (valid for a limited time, only its hash stored) lets the signer read it and
// sign without an account. A signature records the typed name, the time, the address and browser, an optional drawn signature, and
// the hash of the exact text that was signed, so any later change to the text is detectable. This is a simple electronic signature:
// it proves who held the link and what they agreed to, not their legal identity. Free of Next.js imports so it can be tested.
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { notifyMany } from "./notifications";

export class AgreementError extends Error {}
type Db = PrismaClient;

export const AGREEMENT_STATUSES = ["DRAFT", "SENT", "SIGNED", "DECLINED", "VOID"] as const;
export const TEMPLATE_KINDS = ["CONTRACT", "PROPOSAL", "NDA", "OTHER"] as const;
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const clean = (v: string, max: number) => v.replace(/\r\n/g, "\n").trim().slice(0, max);

// Every placeholder a template may use, and where its value comes from
export const PLACEHOLDERS = ["company_name", "client_name", "vendor_name", "date", "signer_name", "amount", "start_date", "end_date"] as const;

export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}
export function fillTemplate(body: string, vars: Record<string, string | null | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") { if (!missing.includes(key)) missing.push(key); return all; }
    return v;
  });
  return { text, missing };
}

export async function saveTemplate(db: Db, p: { organizationId: string; id?: string; name: string; kind: string; body: string; active?: boolean }) {
  const name = clean(p.name, 80);
  if (name.length < 3) throw new AgreementError("Give the template a name.");
  if (!(TEMPLATE_KINDS as readonly string[]).includes(p.kind)) throw new AgreementError("Choose a kind.");
  const body = clean(p.body, 30_000);
  if (body.length < 30) throw new AgreementError("Write the agreement text.");
  const unknown = placeholdersIn(body).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) throw new AgreementError(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `{{${k}}}`).join(", ")}. Allowed: ${PLACEHOLDERS.map((k) => `{{${k}}}`).join(", ")}.`);
  try {
    if (p.id) {
      const r = await db.documentTemplate.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data: { name, kind: p.kind, body, ...(p.active === undefined ? {} : { active: p.active }) } });
      if (r.count === 0) throw new AgreementError("Template not found.");
      return db.documentTemplate.findUniqueOrThrow({ where: { id: p.id } });
    }
    return await db.documentTemplate.create({ data: { organizationId: p.organizationId, name, kind: p.kind, body } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AgreementError("A template with that name already exists.");
    throw e;
  }
}

async function nextNo(tx: Prisma.TransactionClient, organizationId: string) {
  const seq = await tx.numberSequence.upsert({ where: { organizationId_key: { organizationId, key: "AGREEMENT" } }, create: { organizationId, key: "AGREEMENT", next: 2 }, update: { next: { increment: 1 } } });
  return `AGR-${String(seq.next - 1).padStart(4, "0")}`;
}

export async function createAgreement(db: Db, p: { organizationId: string; actorId: string; title: string; body?: string; templateId?: string | null; clientId?: string | null; vendorId?: string | null; amount?: string; startDate?: string; endDate?: string }) {
  const title = clean(p.title, 160);
  if (title.length < 3) throw new AgreementError("Give the agreement a title.");
  if (p.clientId && p.vendorId) throw new AgreementError("An agreement is with a client or a vendor, not both.");
  const client = p.clientId ? await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { name: true } }) : null;
  const vendor = p.vendorId ? await db.vendor.findFirst({ where: { id: p.vendorId, organizationId: p.organizationId }, select: { name: true } }) : null;
  if ((p.clientId && !client) || (p.vendorId && !vendor)) throw new AgreementError("Unknown client or vendor.");
  let text = clean(p.body ?? "", 30_000);
  if (p.templateId) {
    const t = await db.documentTemplate.findFirst({ where: { id: p.templateId, organizationId: p.organizationId, active: true } });
    if (!t) throw new AgreementError("Template not found.");
    const company = (await db.companyProfile.findFirst({ where: { organizationId: p.organizationId, isDefault: true }, select: { legalName: true } }))?.legalName ?? "";
    const filled = fillTemplate(t.body, { company_name: company, client_name: client?.name, vendor_name: vendor?.name, date: new Date().toISOString().slice(0, 10), amount: p.amount, start_date: p.startDate, end_date: p.endDate });
    text = filled.text; // anything still in {{braces}} is left visible so the person fills it before sending
  }
  if (text.length < 30) throw new AgreementError("Write the agreement text or choose a template.");
  return db.$transaction(async (tx) => tx.agreement.create({ data: { organizationId: p.organizationId, number: await nextNo(tx, p.organizationId), title, body: text, bodyHash: sha(`${title}\n${text}`), clientId: p.clientId ?? null, vendorId: p.vendorId ?? null, templateId: p.templateId ?? null, createdById: p.actorId } }));
}

export async function editAgreement(db: Db, p: { organizationId: string; id: string; title: string; body: string }) {
  const a = await db.agreement.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!a) throw new AgreementError("Agreement not found.");
  if (a.status !== "DRAFT") throw new AgreementError("Only a draft can be edited. Void it and create a new one.");
  const title = clean(p.title, 160), body = clean(p.body, 30_000);
  if (title.length < 3 || body.length < 30) throw new AgreementError("Give a title and the agreement text.");
  return db.agreement.update({ where: { id: a.id }, data: { title, body, bodyHash: sha(`${title}\n${body}`) } });
}

export const SIGN_LINK_HOURS = 14 * 24;

// Freezes the text and issues the one-time link. Returns the link token once; only its hash is kept.
export async function sendAgreement(db: Db, p: { organizationId: string; id: string; signerName: string; signerEmail?: string; hours?: number; now?: Date }) {
  const a = await db.agreement.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!a) throw new AgreementError("Agreement not found.");
  if (a.status !== "DRAFT" && a.status !== "SENT") throw new AgreementError("This agreement is already finished.");
  const open = a.body.match(/\{\{[^}]*\}\}/);
  if (open) throw new AgreementError(`Fill in ${open[0]} before sending.`);
  const signerName = clean(p.signerName, 120);
  if (signerName.length < 3) throw new AgreementError("Enter the signer's name.");
  const email = p.signerEmail?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AgreementError("Enter a valid signer email.");
  const token = crypto.randomBytes(32).toString("base64url");
  const now = p.now ?? new Date();
  await db.agreement.update({ where: { id: a.id }, data: { status: "SENT", tokenHash: sha(token), tokenExpiresAt: new Date(now.getTime() + (p.hours ?? SIGN_LINK_HOURS) * 3_600_000), signerName, signerEmail: email, sentAt: now, bodyHash: sha(`${a.title}\n${a.body}`) } });
  return token; // shown once
}

export async function voidAgreement(db: Db, p: { organizationId: string; id: string }) {
  const r = await db.agreement.updateMany({ where: { id: p.id, organizationId: p.organizationId, status: { in: ["DRAFT", "SENT"] } }, data: { status: "VOID", tokenHash: null, tokenExpiresAt: null } });
  if (r.count === 0) throw new AgreementError("Only a draft or a sent agreement can be voided.");
}

// ---------- the signer's side: no account, identified only by the link ----------

export async function loadForSigning(db: Db, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return null;
  const a = await db.agreement.findUnique({ where: { tokenHash: sha(token) } });
  if (!a || a.status !== "SENT" || !a.tokenExpiresAt || a.tokenExpiresAt < now) return null;
  const company = (await db.companyProfile.findFirst({ where: { organizationId: a.organizationId, isDefault: true }, select: { legalName: true } }))?.legalName ?? "";
  return { id: a.id, number: a.number, title: a.title, body: a.body, signerName: a.signerName, expiresAt: a.tokenExpiresAt, company };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function cleanSignature(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || v.length > 120_000) throw new AgreementError("The drawn signature is not valid. Type your name instead, or draw again.");
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length < 100 || !bytes.subarray(0, 8).equals(PNG)) throw new AgreementError("The drawn signature is not valid. Type your name instead, or draw again.");
  return v;
}

export async function signAgreement(db: Db, p: { token: string; name: string; agree: boolean; signatureImage?: string; ip: string | null; userAgent: string | null; now?: Date }) {
  const now = p.now ?? new Date();
  const found = await loadForSigning(db, p.token, now);
  if (!found) throw new AgreementError("This signing link is not valid any more. Ask for a new one.");
  if (!p.agree) throw new AgreementError("Tick the box to confirm you have read and agree to this agreement.");
  const name = clean(p.name, 120);
  if (name.length < 3) throw new AgreementError("Type your full name to sign.");
  const image = cleanSignature(p.signatureImage);
  const a = await db.agreement.findUniqueOrThrow({ where: { id: found.id } });
  // The text must still be exactly what was sent
  if (sha(`${a.title}\n${a.body}`) !== a.bodyHash) throw new AgreementError("This agreement was changed after it was sent. Ask for a new link.");
  // Only the first signature counts; the link dies with it
  const u = await db.agreement.updateMany({ where: { id: a.id, status: "SENT", tokenHash: sha(p.token) }, data: { status: "SIGNED", signerName: name, signedAt: now, signedIp: p.ip?.slice(0, 64) ?? null, signedUserAgent: p.userAgent?.slice(0, 300) ?? null, signatureImage: image, tokenHash: null, tokenExpiresAt: null } });
  if (u.count === 0) throw new AgreementError("This agreement was already signed or withdrawn.");
  await notifyMany(db, [a.createdById], { kind: "agreement.signed", title: `${name} signed ${a.number}`, body: a.title, link: `/agreements/${a.id}`, dedupeKey: `agreement-signed:${a.id}` });
  return db.agreement.findUniqueOrThrow({ where: { id: a.id } });
}

export async function declineAgreement(db: Db, p: { token: string; reason: string; now?: Date }) {
  const found = await loadForSigning(db, p.token, p.now);
  if (!found) throw new AgreementError("This signing link is not valid any more.");
  const reason = clean(p.reason, 500);
  if (reason.length < 3) throw new AgreementError("Tell us briefly why you are declining.");
  const a = await db.agreement.findUniqueOrThrow({ where: { id: found.id } });
  const u = await db.agreement.updateMany({ where: { id: a.id, status: "SENT", tokenHash: sha(p.token) }, data: { status: "DECLINED", declineReason: reason, tokenHash: null, tokenExpiresAt: null } });
  if (u.count === 0) throw new AgreementError("This agreement was already signed or withdrawn.");
  await notifyMany(db, [a.createdById], { kind: "agreement.declined", title: `${a.signerName ?? "The signer"} declined ${a.number}`, body: reason, link: `/agreements/${a.id}`, dedupeKey: `agreement-declined:${a.id}` });
}

// True when the stored text still matches the hash taken when it was sent (and signed)
export const intact = (a: { title: string; body: string; bodyHash: string }) => sha(`${a.title}\n${a.body}`) === a.bodyHash;
