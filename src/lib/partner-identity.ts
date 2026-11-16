// Partner identity checks (KYC) and payout accounts. Free of Next.js imports so it can be tested against the database.
//
// Rules (docs/PARTNER_STACK.md, "Identity and payout accounts"):
// - The ID number and payout account numbers are stored encrypted; only their last four characters are kept in clear.
//   Lists, exports, emails and audit entries never carry the full value.
// - ID images are StoredFile rows (ownerType PARTNER_IDENTITY, ownerId = earner id). The partner sees their own; staff need
//   partners.view_identity, and every staff view is audited by the route that serves the file.
// - A verified identity is required before any payout or resale billing, never before training. It is re-checked yearly.
// - A payout account is never edited: a change is a new account. A new account waits 48 hours before it can be used, staff are
//   told, and the partner gets a security email. An account whose title does not match the partner's verified name needs a
//   staff approval first. Payments are made by hand: no wallet or card integration is connected.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import type { FileActor } from "./file-access";
import { FileError, saveFile } from "./files";
import type { StorageProvider } from "./storage";
import { notifyMany, usersWithPermission } from "./notifications";

type Db = PrismaClient;

export class IdentityError extends Error { constructor(message: string, readonly field?: string) { super(message); } }

export const ID_TYPES = [
  ["CNIC", "CNIC (Pakistan)"],
  ["NICOP", "NICOP (overseas Pakistani)"],
  ["PASSPORT", "Passport"],
  ["SSN", "Social Security Number (United States)"],
] as const;
export type IdType = (typeof ID_TYPES)[number][0];
export const ID_TYPE_LABEL: Record<string, string> = Object.fromEntries(ID_TYPES);

// Which pictures each ID type needs. SSN cards carry no photo, so a US partner adds a photo ID (driving licence or passport).
export const DOCUMENTS: Record<IdType, { key: string; label: string }[]> = {
  CNIC: [{ key: "FRONT", label: "CNIC front" }, { key: "BACK", label: "CNIC back" }],
  NICOP: [{ key: "FRONT", label: "NICOP front" }, { key: "BACK", label: "NICOP back" }],
  PASSPORT: [{ key: "PASSPORT", label: "Passport photo page" }],
  SSN: [{ key: "PHOTO_ID", label: "Photo ID (driving licence or passport)" }],
};
export const DOCUMENT_LABEL: Record<string, string> = { FRONT: "ID front", BACK: "ID back", PASSPORT: "Passport photo page", PHOTO_ID: "Photo ID" };
export const isIdType = (v: string): v is IdType => v in DOCUMENTS;

export const PAYOUT_METHODS = [
  ["BANK", "Bank account"],
  ["EASYPAISA", "Easypaisa"],
  ["JAZZCASH", "JazzCash"],
  ["SADAPAY", "SadaPay"],
  ["NAYAPAY", "NayaPay"],
  ["PAYPAL", "PayPal"],
  ["STRIPE", "Stripe"],
  ["OTHER", "Other"],
] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number][0];
export const PAYOUT_METHOD_LABEL: Record<string, string> = Object.fromEntries(PAYOUT_METHODS);
export const isPayoutMethod = (v: string): v is PayoutMethod => v in PAYOUT_METHOD_LABEL;
// What the account field holds for each method (the form label)
export const ACCOUNT_FIELD: Record<PayoutMethod, string> = {
  BANK: "IBAN", EASYPAISA: "Wallet mobile number", JAZZCASH: "Wallet mobile number", SADAPAY: "Wallet number or IBAN", NAYAPAY: "Wallet number or IBAN",
  PAYPAL: "PayPal email", STRIPE: "Stripe account email or ID", OTHER: "Account number or ID",
};

export const PAYOUT_HOLD_HOURS = 48;
export const RECHECK_DAYS = 365;
export const RECHECK_REMINDER_DAYS = 30;
const DAY = 86400000;

// ----- Encryption of the sensitive values -----

const derive = (secret: string) => crypto.createHash("sha256").update(`partner-identity:${secret}`).digest();
const appSecret = () => process.env.SESSION_SECRET ?? "";

export function seal(plain: string, secret = appSecret()): string {
  if (secret.length < 32) throw new IdentityError("The server is missing its secret key, so identity details cannot be stored safely. Ask the administrator to set SESSION_SECRET.");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", derive(secret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function unseal(stored: string, secret = appSecret()): string | null {
  try {
    const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", derive(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const masked = (last4: string) => `•••• ${last4}`;

// ----- Pure rules -----

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// The ID number in its standard written form, or an error. CNIC and NICOP: 13 digits written 12345-1234567-1.
export function normalizeIdNumber(type: IdType, raw: string): string {
  const v = raw.trim().toUpperCase();
  if (type === "CNIC" || type === "NICOP") {
    const d = v.replace(/[\s-]/g, "");
    if (!/^\d{13}$/.test(d)) throw new IdentityError(`Enter the 13-digit ${type} number, for example 35202-1234567-1.`, "idNumber");
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  }
  if (type === "SSN") {
    const d = v.replace(/[\s-]/g, "");
    if (!/^\d{9}$/.test(d)) throw new IdentityError("Enter the 9-digit Social Security Number.", "idNumber");
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  }
  const p = v.replace(/\s/g, "");
  if (!/^[A-Z0-9]{6,12}$/.test(p)) throw new IdentityError("Enter the passport number as printed (6 to 12 letters and numbers).", "idNumber");
  return p;
}

const lastFour = (v: string) => v.replace(/[^A-Za-z0-9@.]/g, "").slice(-4);

// Name comparison for payout account titles: ignore case, punctuation, honorifics and company suffixes.
const FILLER = new Set(["mr", "mrs", "ms", "miss", "dr", "m", "s", "ms.", "pvt", "private", "ltd", "limited", "llc", "inc", "co", "company", "the", "smc", "and", "&"]);
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/m\/s/g, " ").replace(/[^a-z0-9& ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).sort().join(" ");
}
export function titleMatches(title: string, names: (string | null | undefined)[]): boolean {
  const t = nameKey(title);
  return t.length > 0 && names.some((n) => !!n && nameKey(n) === t);
}

export function validatePayoutAccount(method: PayoutMethod, raw: string): string {
  const v = raw.trim();
  if (method === "BANK") {
    const iban = v.replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw new IdentityError("Enter the IBAN, for example PK36SCBL0000001123456702.", "account");
    if (iban.startsWith("PK") && iban.length !== 24) throw new IdentityError("A Pakistani IBAN has 24 characters, starting with PK.", "account");
    return iban;
  }
  if (method === "EASYPAISA" || method === "JAZZCASH") {
    const d = v.replace(/[\s-]/g, "").replace(/^\+?92/, "0");
    if (!/^03\d{9}$/.test(d)) throw new IdentityError("Enter the wallet mobile number, for example 0300 1234567.", "account");
    return d;
  }
  if (method === "PAYPAL") {
    const e = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new IdentityError("Enter the email address of the PayPal account.", "account");
    return e;
  }
  const a = v.replace(/\s+/g, " ");
  if (a.length < 4 || a.length > 60) throw new IdentityError(`Enter the ${ACCOUNT_FIELD[method].toLowerCase()} (4 to 60 characters).`, "account");
  return a;
}

export type PayoutState = "REMOVED" | "NEEDS_APPROVAL" | "ON_HOLD" | "READY";
export function payoutState(a: { removedAt: Date | null; titleMatches: boolean; approvedAt: Date | null; usableFrom: Date }, now = new Date()): PayoutState {
  if (a.removedAt) return "REMOVED";
  if (!a.titleMatches && !a.approvedAt) return "NEEDS_APPROVAL";
  if (a.usableFrom > now) return "ON_HOLD";
  return "READY";
}
export const PAYOUT_STATE_LABEL: Record<PayoutState, string> = { REMOVED: "Removed", NEEDS_APPROVAL: "Name check by Hifi", ON_HOLD: "Safety hold", READY: "Ready" };

export type IdentityState = "NOT_SUBMITTED" | "SUBMITTED" | "VERIFIED" | "RECHECK_DUE" | "REJECTED";
export function identityState(i: { status: string; recheckDueAt: Date | null } | null, now = new Date()): IdentityState {
  if (!i) return "NOT_SUBMITTED";
  if (i.status === "VERIFIED" && i.recheckDueAt && i.recheckDueAt <= now) return "RECHECK_DUE";
  return i.status as IdentityState;
}
export const IDENTITY_STATE_LABEL: Record<IdentityState, string> = { NOT_SUBMITTED: "Not submitted", SUBMITTED: "Waiting for review", VERIFIED: "Verified", RECHECK_DUE: "Yearly re-check due", REJECTED: "Needs changes" };

// ----- Identity -----

export type IdentityInput = { legalName: string; idType: string; idNumber: string; businessName?: string; ntn?: string; secpNumber?: string; activeTaxpayer?: boolean; address: string };

async function earnerIn(db: Db, organizationId: string, earnerId: string) {
  const e = await db.earner.findFirst({ where: { id: earnerId, organizationId } });
  if (!e) throw new IdentityError("Partner not found.");
  return e;
}

export async function documentsFor(db: Db, organizationId: string, earnerId: string) {
  return db.storedFile.findMany({ where: { organizationId, ownerType: "PARTNER_IDENTITY", ownerId: earnerId, deletedAt: null }, orderBy: { createdAt: "desc" } });
}

export const ID_DOC_MAX_BYTES = 5 * 1024 * 1024;

// Adds one ID picture (JPG, PNG or PDF, up to 5 MB) and retires the earlier picture of the same side, which stays recoverable
// until the retention purge. Access is checked by saveFile against the PARTNER_IDENTITY rule.
export async function saveIdentityDocument(db: Db, storage: StorageProvider, p: { actor: FileActor; earnerId: string; category: string; name: string; bytes: Buffer }) {
  if (!(p.category in DOCUMENT_LABEL)) throw new IdentityError("Unknown document.");
  const ext = p.name.toLowerCase().split(".").pop() ?? "";
  if (!["jpg", "jpeg", "png", "pdf"].includes(ext)) throw new FileError("Upload a JPG, PNG or PDF picture of your ID.");
  const f = await saveFile(db, storage, { actor: p.actor, ownerType: "PARTNER_IDENTITY", ownerId: p.earnerId, name: p.name, bytes: p.bytes, category: p.category, maxBytes: ID_DOC_MAX_BYTES });
  await db.storedFile.updateMany({
    where: { organizationId: p.actor.organizationId, ownerType: "PARTNER_IDENTITY", ownerId: p.earnerId, category: p.category, deletedAt: null, id: { not: f.id } },
    data: { deletedAt: new Date(), deletedById: p.actor.id },
  });
  return f;
}

// Saves the partner's details and sends them for review. Used by the partner in the portal and by staff filling it in for them.
// Any change to a verified identity goes back to review. `idNumber` may be left empty to keep the number already on file.
export async function submitIdentity(db: Db, p: { organizationId: string; earnerId: string; actorId: string; byStaff: boolean; input: IdentityInput; now?: Date }) {
  const now = p.now ?? new Date();
  const earner = await earnerIn(db, p.organizationId, p.earnerId);
  const existing = await db.partnerIdentity.findUnique({ where: { earnerId: earner.id } });
  const i = p.input;
  const legalName = clean(i.legalName, 120);
  if (legalName.length < 3) throw new IdentityError("Enter your full legal name exactly as on your ID.", "legalName");
  if (!isIdType(i.idType)) throw new IdentityError("Choose the type of ID.", "idType");
  const typeChanged = !!existing && existing.idType !== i.idType;
  let idNumberEnc = existing?.idNumberEnc;
  let idLast4 = existing?.idLast4;
  if (i.idNumber.trim() || !existing || typeChanged) {
    const n = normalizeIdNumber(i.idType, i.idNumber);
    idNumberEnc = seal(n);
    idLast4 = lastFour(n);
  }
  const address = clean(i.address, 300);
  if (address.length < 8) throw new IdentityError("Enter your full address.", "address");
  const businessName = clean(i.businessName, 160) || null;
  const ntn = clean(i.ntn, 20) || null;
  if (ntn && !/^[0-9A-Za-z-]{7,15}$/.test(ntn)) throw new IdentityError("Enter the NTN as issued, for example 1234567-8.", "ntn");
  const secpNumber = clean(i.secpNumber, 30) || null;
  const docs = await documentsFor(db, p.organizationId, earner.id);
  const missing = DOCUMENTS[i.idType].filter((d) => !docs.some((f) => f.category === d.key));
  if (missing.length) throw new IdentityError(`Upload the ${missing.map((m) => m.label).join(" and ")}.`, "documents");

  const data = {
    legalName, idType: i.idType, idNumberEnc: idNumberEnc!, idLast4: idLast4!, businessName, ntn, secpNumber, activeTaxpayer: !!i.activeTaxpayer && !!ntn, address,
    status: "SUBMITTED", rejectReason: null, submittedAt: now, reviewedById: null, reviewedAt: null,
  };
  const row = existing
    ? await db.partnerIdentity.update({ where: { id: existing.id }, data })
    : await db.partnerIdentity.create({ data: { organizationId: p.organizationId, earnerId: earner.id, ...data } });
  // Titles of payout accounts are judged against the names now on file
  await refreshTitleMatches(db, earner.id, [legalName, businessName]);
  if (!p.byStaff) {
    await notifyMany(db, await usersWithPermission(db, p.organizationId, "partners.view_identity"), {
      kind: "partner.identity", title: `Identity details to check: ${earner.name}`, body: `${ID_TYPE_LABEL[i.idType]} · ${existing ? "updated" : "new"}`, link: `/partner-stack/partners?open=${earner.id}`, dedupeKey: `partner-identity:${row.id}:${now.getTime()}`,
    });
  }
  return { before: existing, after: row };
}

export async function reviewIdentity(db: Db, p: { organizationId: string; earnerId: string; actorId: string; decision: "VERIFY" | "REJECT"; reason?: string; now?: Date }) {
  const now = p.now ?? new Date();
  const earner = await earnerIn(db, p.organizationId, p.earnerId);
  const row = await db.partnerIdentity.findUnique({ where: { earnerId: earner.id } });
  if (!row) throw new IdentityError("This partner has not sent their identity details yet.");
  if (row.status !== "SUBMITTED") throw new IdentityError("Only details waiting for review can be verified or sent back.");
  const reason = clean(p.reason, 600);
  if (p.decision === "REJECT" && reason.length < 3) throw new IdentityError("Write what the partner needs to correct. They will see it.", "reason");
  const done = await db.partnerIdentity.updateMany({
    where: { id: row.id, status: "SUBMITTED" },
    data: p.decision === "VERIFY"
      ? { status: "VERIFIED", rejectReason: null, reviewedById: p.actorId, reviewedAt: now, recheckDueAt: new Date(now.getTime() + RECHECK_DAYS * DAY), reminderSentAt: null }
      : { status: "REJECTED", rejectReason: reason, reviewedById: p.actorId, reviewedAt: now },
  });
  if (done.count === 0) throw new IdentityError("Someone else reviewed these details a moment ago.");
  const after = await db.partnerIdentity.findUniqueOrThrow({ where: { id: row.id } });
  await sendTemplateQuietly(db, {
    organizationId: p.organizationId, key: "partner_identity_result", to: earner.email, relatedType: "Earner", relatedId: earner.id,
    vars: {
      first_name: firstName(earner.name), result: p.decision === "VERIFY" ? "verified" : "needs changes", link: `${appUrl()}/partner/details`,
      note: p.decision === "VERIFY" ? "Your identity is verified. Once your payout account is ready you can receive payouts from Hifi." : `Please correct the following and send your details again: ${reason}`,
    },
  });
  return { before: row, after };
}

// The full ID number, for a person allowed to see it. The caller writes the audit entry (without the number).
export async function revealIdNumber(db: Db, organizationId: string, earnerId: string): Promise<string | null> {
  const row = await db.partnerIdentity.findFirst({ where: { earnerId, organizationId } });
  return row ? unseal(row.idNumberEnc) : null;
}

// ----- Payout accounts -----

export type PayoutInput = { method: string; otherName?: string; bankName?: string; accountTitle: string; account: string; makeDefault?: boolean };

async function refreshTitleMatches(db: Db, earnerId: string, names: (string | null)[]) {
  const live = await db.partnerPayoutAccount.findMany({ where: { earnerId, removedAt: null } });
  for (const a of live) {
    const m = titleMatches(a.accountTitle, names);
    if (m !== a.titleMatches) await db.partnerPayoutAccount.update({ where: { id: a.id }, data: { titleMatches: m } });
  }
}

export async function addPayoutAccount(db: Db, p: { organizationId: string; earnerId: string; actorId: string; byStaff: boolean; input: PayoutInput; now?: Date }) {
  const now = p.now ?? new Date();
  const earner = await earnerIn(db, p.organizationId, p.earnerId);
  const i = p.input;
  if (!isPayoutMethod(i.method)) throw new IdentityError("Choose how you want to be paid.", "method");
  const otherName = i.method === "OTHER" ? clean(i.otherName, 60) : "";
  if (i.method === "OTHER" && otherName.length < 2) throw new IdentityError("Enter the name of the payment service.", "otherName");
  const bankName = i.method === "BANK" ? clean(i.bankName, 80) : "";
  if (i.method === "BANK" && bankName.length < 2) throw new IdentityError("Enter the bank name.", "bankName");
  const accountTitle = clean(i.accountTitle, 120);
  if (accountTitle.length < 3) throw new IdentityError("Enter the account title exactly as the bank or wallet shows it.", "accountTitle");
  const account = validatePayoutAccount(i.method, i.account);
  const live = await db.partnerPayoutAccount.findMany({ where: { earnerId: earner.id, removedAt: null } });
  if (live.length >= 5) throw new IdentityError("You can keep up to 5 payout accounts. Remove one you no longer use first.");
  if (live.some((a) => a.method === i.method && unseal(a.accountEnc) === account)) throw new IdentityError("This account is already saved.", "account");
  const identity = await db.partnerIdentity.findUnique({ where: { earnerId: earner.id } });
  const matches = titleMatches(accountTitle, [identity?.legalName, identity?.businessName]);
  const makeDefault = !!i.makeDefault || live.length === 0;
  const usableFrom = new Date(now.getTime() + PAYOUT_HOLD_HOURS * 3600000);
  const row = await db.$transaction(async (tx) => {
    if (makeDefault) await tx.partnerPayoutAccount.updateMany({ where: { earnerId: earner.id, removedAt: null }, data: { isDefault: false } });
    return tx.partnerPayoutAccount.create({
      data: {
        organizationId: p.organizationId, earnerId: earner.id, method: i.method, otherName: otherName || null, bankName: bankName || null, accountTitle,
        accountEnc: seal(account), accountLast4: lastFour(account), isDefault: makeDefault, titleMatches: matches, usableFrom, createdById: p.actorId, createdAt: now,
      },
    });
  });
  const methodName = i.method === "OTHER" ? otherName : PAYOUT_METHOD_LABEL[i.method];
  await notifyMany(db, await usersWithPermission(db, p.organizationId, "partners.manage"), {
    kind: "partner.payout_account", title: `Payout account added: ${earner.name}`, body: `${methodName} ending ${row.accountLast4}${matches ? "" : " · title does not match their verified name, needs your approval"}${p.byStaff ? " · added by staff" : ""}`,
    link: `/partner-stack/partners?open=${earner.id}`, dedupeKey: `partner-payout:${row.id}`,
  });
  await sendTemplateQuietly(db, {
    organizationId: p.organizationId, key: "partner_payout_added", to: earner.email, relatedType: "Earner", relatedId: earner.id,
    vars: { first_name: firstName(earner.name), method: methodName, account: row.accountLast4, usable_from: usableFrom.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" }), link: `${appUrl()}/partner/details` },
  });
  return row;
}

async function liveAccount(db: Db, p: { organizationId: string; earnerId: string; accountId: string }) {
  const a = await db.partnerPayoutAccount.findFirst({ where: { id: p.accountId, earnerId: p.earnerId, organizationId: p.organizationId, removedAt: null } });
  if (!a) throw new IdentityError("Payout account not found.");
  return a;
}

export async function removePayoutAccount(db: Db, p: { organizationId: string; earnerId: string; accountId: string; actorId: string; now?: Date }) {
  const a = await liveAccount(db, p);
  return db.$transaction(async (tx) => {
    const removed = await tx.partnerPayoutAccount.update({ where: { id: a.id }, data: { removedAt: p.now ?? new Date(), removedById: p.actorId, isDefault: false } });
    if (a.isDefault) {
      const next = await tx.partnerPayoutAccount.findFirst({ where: { earnerId: a.earnerId, removedAt: null }, orderBy: { createdAt: "asc" } });
      if (next) await tx.partnerPayoutAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return removed;
  });
}

export async function setDefaultPayoutAccount(db: Db, p: { organizationId: string; earnerId: string; accountId: string }) {
  const a = await liveAccount(db, p);
  await db.$transaction([
    db.partnerPayoutAccount.updateMany({ where: { earnerId: a.earnerId, removedAt: null }, data: { isDefault: false } }),
    db.partnerPayoutAccount.update({ where: { id: a.id }, data: { isDefault: true } }),
  ]);
  return a;
}

// Staff confirm an account whose title does not match the partner's name (for example a business account under a trading name).
export async function approvePayoutAccount(db: Db, p: { organizationId: string; earnerId: string; accountId: string; actorId: string; now?: Date }) {
  const a = await liveAccount(db, p);
  if (a.titleMatches || a.approvedAt) throw new IdentityError("This account does not need an approval.");
  if (a.createdById === p.actorId) throw new IdentityError("Someone other than the person who added this account must approve it.");
  return db.partnerPayoutAccount.update({ where: { id: a.id }, data: { approvedById: p.actorId, approvedAt: p.now ?? new Date() } });
}

export async function revealPayoutAccount(db: Db, p: { organizationId: string; earnerId: string; accountId: string }): Promise<string | null> {
  const a = await db.partnerPayoutAccount.findFirst({ where: { id: p.accountId, earnerId: p.earnerId, organizationId: p.organizationId } });
  return a ? unseal(a.accountEnc) : null;
}

// Whether Hifi may pay this partner now, and the account to pay into. Every payout screen must ask this first.
export async function payoutReadiness(db: Db, p: { organizationId: string; earnerId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const [identity, accounts] = await Promise.all([
    db.partnerIdentity.findFirst({ where: { earnerId: p.earnerId, organizationId: p.organizationId } }),
    db.partnerPayoutAccount.findMany({ where: { earnerId: p.earnerId, organizationId: p.organizationId, removedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const reasons: string[] = [];
  const st = identityState(identity, now);
  if (st !== "VERIFIED") reasons.push(st === "RECHECK_DUE" ? "The yearly identity re-check is due." : `Identity: ${IDENTITY_STATE_LABEL[st].toLowerCase()}.`);
  const account = accounts.find((a) => a.isDefault) ?? null;
  if (!account) reasons.push("No payout account.");
  else {
    const s = payoutState(account, now);
    if (s === "NEEDS_APPROVAL") reasons.push("The default payout account's title does not match the verified name and needs approval.");
    if (s === "ON_HOLD") reasons.push(`The default payout account is on its safety hold until ${account.usableFrom.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" })} (Pakistan time).`);
  }
  return { ready: reasons.length === 0, reasons, account };
}

// Daily: 30 days before the yearly re-check, ask the partner to confirm their details (once per cycle).
export async function sendIdentityRecheckReminders(db: Db, organizationId: string, now = new Date()) {
  const due = await db.partnerIdentity.findMany({
    where: { organizationId, status: "VERIFIED", reminderSentAt: null, recheckDueAt: { lte: new Date(now.getTime() + RECHECK_REMINDER_DAYS * DAY) } },
    include: { earner: { select: { name: true, email: true, status: true } } },
  });
  let sent = 0;
  for (const i of due) {
    if (i.earner.status !== "ACTIVE") continue;
    const claimed = await db.partnerIdentity.updateMany({ where: { id: i.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claimed.count === 0) continue;
    await sendTemplateQuietly(db, {
      organizationId, key: "partner_identity_recheck", to: i.earner.email, relatedType: "Earner", relatedId: i.earnerId,
      vars: { first_name: firstName(i.earner.name), due_date: i.recheckDueAt!.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), link: `${appUrl()}/partner/details` },
    });
    sent++;
  }
  return sent;
}

// One tone per state, used by the partner portal and the staff screen alike
export const IDENTITY_TONE: Record<IdentityState, "neutral" | "warning" | "success" | "danger"> = { NOT_SUBMITTED: "neutral", SUBMITTED: "warning", VERIFIED: "success", RECHECK_DUE: "warning", REJECTED: "danger" };
export const PAYOUT_TONE: Record<PayoutState, "neutral" | "warning" | "success" | "danger"> = { REMOVED: "neutral", NEEDS_APPROVAL: "warning", ON_HOLD: "warning", READY: "success" };
