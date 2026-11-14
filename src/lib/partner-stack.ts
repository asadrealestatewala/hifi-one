// Hifi Partner Stack, Phase 1: the public inquiry and application forms, approval, partner terms, certificates and their
// reminders. Free of Next.js imports so it can be tested against the database.
//
// Rules enforced here, not in the screens:
// - Every default (rates, durations, certificate validity, reminder days, terms) is stored and editable; the constants below are only
//   the starting values written the first time the programme is opened.
// - A partner's login is a User with userType PARTNER, bound to exactly one Earner; partner pages read only that earner's rows.
// - Approving creates the earner, the login, and certificates for the chosen Solutions in one transaction; emails go out afterwards and
//   never undo an approval when they fail.
// - Certificate validity: the partner's own setting, else the Solution's, else the global default.
// - The public verification answer reveals only the name, Solution, dates and status.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createResetLink } from "./accounts";
import { SAAS_PRODUCTS } from "./bootstrap";
import { normalizeEmail, normalizePhone } from "./contacts";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { certificatePdf, isCertificateDesign } from "./partner-certificate-pdf";
import { notifyMany, usersWithPermission } from "./notifications";

type Db = PrismaClient;
export class PartnerError extends Error { constructor(message: string, readonly status = 400, readonly field?: string) { super(message); } }

export const TYPE_KEYS = ["REFERRAL", "RESELLER", "EXCLUSIVE", "SALES_AGENT"] as const;
export const INTEREST_KEYS = ["REFERRAL", "RESELLER", "EXCLUSIVE", "NOT_SURE"] as const;
export const PROFESSIONS = [
  ["STUDENT", "University student"], ["EMPLOYED", "Employed"], ["BUSINESS_OWNER", "Business owner"],
  ["FREELANCER", "Freelancer"], ["INDUSTRY_PROFESSIONAL", "Industry professional"], ["OTHER", "Other"],
] as const;
export const PROFESSION_LABEL: Record<string, string> = Object.fromEntries(PROFESSIONS);
export const APPLICATION_STATUSES = ["NEW", "APPROVED", "REJECTED"] as const;
export const INQUIRY_STATUSES = ["NEW", "REPLIED", "CLOSED"] as const;

// ----- Defaults, written once and then edited in Partner Stack settings -----

export const DEFAULT_TYPES = [
  { key: "REFERRAL", name: "Referral Partner", defaultRate: "20", defaultDurationMonths: null as number | null, leadSharing: false, publicOffer: true, sortOrder: 1,
    description: "You introduce a business. Hifi demos, closes and supports the client. You earn recurring commission." },
  { key: "RESELLER", name: "Reseller Partner", defaultRate: "30", defaultDurationMonths: null as number | null, leadSharing: false, publicOffer: true, sortOrder: 2,
    description: "You run the demo, close the sale and support your client. You earn the highest recurring commission." },
  { key: "EXCLUSIVE", name: "Exclusive Sales Partner", defaultRate: "30", defaultDurationMonths: null as number | null, leadSharing: true, publicOffer: true, sortOrder: 3,
    description: "Your rate is agreed with you. You receive Hifi leads in your territory." },
  { key: "SALES_AGENT", name: "Sales Agent", defaultRate: "20", defaultDurationMonths: null as number | null, leadSharing: false, publicOffer: false, sortOrder: 4,
    description: "A Hifi employee earning commission on the clients they close." },
];

export const DEFAULT_TERMS = `Hifi Partner Stack: partner terms (draft for review)

1. Who can join. Anyone aged 18 or over who gives true information, including students, employees, business owners, freelancers and industry professionals. If you are employed, you confirm that selling Hifi Solutions does not breach your employer's rules.
2. How you earn. You earn the commission percentage and duration set for you when you are approved, on money Hifi actually receives from clients you are credited with. Refunds and cancellations reduce or stop commission. Hifi decides who is credited with a client, and every change is recorded.
3. Honest selling. You will describe Solutions truthfully, will not promise features or prices Hifi has not agreed, and will not spam people.
4. Certification. You may present yourself as an authorised partner only for Solutions you hold a valid certificate for. A certificate can expire or be revoked, and then you stop presenting yourself as authorised.
5. Privacy. You will keep client and lead information confidential and use it only to sell and support Hifi Solutions.
6. Ending. Either side may end the partnership at any time. Hifi may suspend or end it for breaking these terms.
7. Changes. Hifi may update these terms and will tell you before they apply.`;

export const DEFAULT_SETTINGS: Record<string, string> = {
  cert_expiry_days: "30",
  cert_first_reminder_days: "7",
  cert_final_reminder_days: "1",
  calculator_price: "50",
  calculator_currency: "USD",
  terms_text: DEFAULT_TERMS,
  cert_design: "modern",
  cert_signatory_name: "",
  cert_signatory_title: "",
  linkedin_company_id: "",
};

export const SOLUTION_EXPIRY_KEY = (code: string) => `cert_expiry_days:${code}`;

// Idempotent: creates the earner types, the settings and every Solution of the programme (including Campusly) when missing.
export async function ensurePartnerDefaults(db: Db, organizationId: string) {
  for (const t of DEFAULT_TYPES) {
    await db.earnerType.upsert({ where: { organizationId_key: { organizationId, key: t.key } }, update: {}, create: { organizationId, ...t } });
  }
  for (const [i, p] of SAAS_PRODUCTS.entries()) {
    await db.saasProduct.upsert({ where: { organizationId_code: { organizationId, code: p.code } }, update: {}, create: { organizationId, ...p, sortOrder: i } });
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.partnerSetting.upsert({ where: { organizationId_key: { organizationId, key } }, update: {}, create: { organizationId, key, value } });
  }
}

export async function getSettings(db: Db, organizationId: string): Promise<Record<string, string>> {
  const rows = await db.partnerSetting.findMany({ where: { organizationId } });
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

const positiveInt = (v: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= max ? n : fallback;
};

// Which validity applies: the partner's own, else the Solution's, else the global default.
export function certificateValidityDays(settings: Record<string, string>, solutionCode: string, earnerDays?: number | null): number {
  if (earnerDays && earnerDays > 0) return earnerDays;
  const perSolution = settings[SOLUTION_EXPIRY_KEY(solutionCode)];
  if (perSolution && perSolution.trim()) return positiveInt(perSolution, positiveInt(settings.cert_expiry_days, 30, 3650), 3650);
  return positiveInt(settings.cert_expiry_days, 30, 3650);
}

export async function saveSettings(db: Db, p: { organizationId: string; actorId: string; values: Record<string, string> }) {
  const clean: Record<string, string> = {};
  const days = (label: string, v: string, allowBlank: boolean) => {
    const t = v.trim();
    if (!t && allowBlank) return "";
    if (!/^\d{1,4}$/.test(t) || Number(t) < 1) throw new PartnerError(`${label}: enter a whole number of days, 1 or more.`);
    return String(Number(t));
  };
  for (const [key, raw] of Object.entries(p.values)) {
    const v = raw.replace(/\r\n/g, "\n");
    if (key === "cert_expiry_days") clean[key] = days("Certificate validity", v, false);
    else if (key === "cert_first_reminder_days") clean[key] = days("First reminder", v, false);
    else if (key === "cert_final_reminder_days") clean[key] = days("Final reminder", v, false);
    else if (key.startsWith("cert_expiry_days:")) clean[key] = days(`Validity for ${key.split(":")[1]}`, v, true);
    else if (key === "calculator_price") { if (!/^\d{1,6}(\.\d{1,2})?$/.test(v.trim())) throw new PartnerError("Calculator price: enter an amount."); clean[key] = v.trim(); }
    else if (key === "calculator_currency") { if (!/^[A-Z]{3}$/.test(v.trim().toUpperCase())) throw new PartnerError("Currency: use a three-letter code such as USD."); clean[key] = v.trim().toUpperCase(); }
    else if (key === "cert_design") { if (!isCertificateDesign(v.trim())) throw new PartnerError("Certificate design: pick one of the designs shown."); clean[key] = v.trim(); }
    else if (key === "cert_signatory_name" || key === "cert_signatory_title") {
      const t = v.trim().replace(/\s+/g, " ");
      if (t.length > 80) throw new PartnerError("Signatory name and title: keep each under 80 characters.");
      clean[key] = t;
    }
    else if (key === "linkedin_company_id") { const t = v.trim(); if (t && !/^\d{1,15}$/.test(t)) throw new PartnerError("LinkedIn company page ID: use the number only, or leave it empty."); clean[key] = t; }
    else if (key === "terms_text") { if (v.trim().length < 20 || v.length > 20_000) throw new PartnerError("Terms: write between 20 and 20,000 characters."); clean[key] = v.trim(); }
  }
  if (Number(clean.cert_final_reminder_days ?? 1) >= Number(clean.cert_first_reminder_days ?? 7) && clean.cert_final_reminder_days && clean.cert_first_reminder_days) {
    throw new PartnerError("The final reminder must come fewer days before expiry than the first.");
  }
  for (const [key, value] of Object.entries(clean)) {
    if (value === "" && key.startsWith("cert_expiry_days:")) { await db.partnerSetting.deleteMany({ where: { organizationId: p.organizationId, key } }); continue; }
    await db.partnerSetting.upsert({ where: { organizationId_key: { organizationId: p.organizationId, key } }, update: { value, updatedById: p.actorId }, create: { organizationId: p.organizationId, key, value, updatedById: p.actorId } });
  }
  return clean;
}

export async function saveEarnerType(db: Db, p: { organizationId: string; key: string; rate: string; durationMonths: string; leadSharing: boolean; publicOffer: boolean; active: boolean }) {
  const t = await db.earnerType.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key: p.key } } });
  if (!t) throw new PartnerError("Unknown partner type.", 404);
  const rate = cleanRate(p.rate);
  const months = cleanDuration(p.durationMonths);
  return { before: t, after: await db.earnerType.update({ where: { id: t.id }, data: { defaultRate: rate, defaultDurationMonths: months, leadSharing: p.leadSharing, publicOffer: p.publicOffer, active: p.active } }) };
}

export function cleanRate(v: string): string {
  const t = v.trim().replace(/%$/, "");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t) || Number(t) > 50) throw new PartnerError("Enter a commission between 0 and 50 percent, with up to two decimals.", 400, "ratePercent");
  return t;
}

// "" or "lifetime" = lifetime (null); otherwise whole months from 1 to 600.
export function cleanDuration(v: string): number | null {
  const t = v.trim().toLowerCase();
  if (!t || t === "lifetime") return null;
  if (!/^\d{1,3}$/.test(t) || Number(t) < 1 || Number(t) > 600) throw new PartnerError("Duration: choose Lifetime or a number of months from 1 to 600.", 400, "durationMonths");
  return Number(t);
}

export const durationLabel = (months: number | null | undefined) =>
  months == null ? "Lifetime (as long as the client keeps paying)" : months % 12 === 0 ? `${months / 12} year${months === 12 ? "" : "s"}` : `${months} months`;

// ----- Public page data -----

export async function publicProgramme(db: Db, organizationId: string) {
  await ensureOnce(db, organizationId);
  const [types, solutions, settings] = await Promise.all([
    db.earnerType.findMany({ where: { organizationId, active: true, publicOffer: true }, orderBy: { sortOrder: "asc" } }),
    db.saasProduct.findMany({ where: { organizationId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getSettings(db, organizationId),
  ]);
  return { types, solutions, settings };
}

const ensured = new Set<string>();
async function ensureOnce(db: Db, organizationId: string) {
  if (ensured.has(organizationId)) return;
  await ensurePartnerDefaults(db, organizationId);
  ensured.add(organizationId);
}

// ----- Public forms -----

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
const clientIp = (ip: string | null | undefined) => (ip ?? "").slice(0, 64) || null;

export async function submitInquiry(db: Db, p: { organizationId: string; input: Record<string, unknown> }) {
  const i = p.input;
  if (cut(i.website_url, 200)) return { ok: true as const, stored: false }; // honeypot: bots get a normal answer
  const name = cut(i.name, 120);
  if (name.length < 2) throw new PartnerError("Enter your name.", 400, "name");
  const email = normalizeEmail(cut(i.email, 200));
  if (!email) throw new PartnerError("Enter a valid email address so we can reply.", 400, "email");
  const phone = normalizePhone(cut(i.phone, 40));
  if (!phone) throw new PartnerError("Enter your phone or WhatsApp number.", 400, "phone");
  const message = cut(i.message, 2000);
  if (message.length < 5) throw new PartnerError("Tell us your question.", 400, "message");
  const interested = (INTEREST_KEYS as readonly string[]).includes(cut(i.interestedType, 20)) ? cut(i.interestedType, 20) : "NOT_SURE";
  const row = await db.partnerInquiry.create({
    data: { organizationId: p.organizationId, name, email, phone, city: cut(i.city, 80) || null, country: cut(i.country, 80) || null, profession: cut(i.profession, 120) || null, interestedType: interested, message },
  });
  await notifyMany(db, await usersWithPermission(db, p.organizationId, "partners.manage"), {
    kind: "partner.inquiry", title: `Partner question from ${name}`, body: message.slice(0, 140), link: "/partner-stack/inquiries", dedupeKey: `partner-inquiry:${row.id}`,
  });
  await sendTemplateQuietly(db, { organizationId: p.organizationId, key: "partner_inquiry_reply", to: email, relatedType: "PartnerInquiry", relatedId: row.id, vars: { first_name: firstName(name), message: message.slice(0, 300) } });
  return { ok: true as const, stored: true };
}

export async function submitApplication(db: Db, p: { organizationId: string; input: Record<string, unknown>; ip?: string | null; now?: Date }) {
  const i = p.input;
  const now = p.now ?? new Date();
  if (cut(i.website_url, 200)) return { ok: true as const, stored: false, duplicate: false };
  const name = cut(i.name, 120);
  if (name.length < 2) throw new PartnerError("Enter your full name.", 400, "name");
  const email = normalizeEmail(cut(i.email, 200));
  if (!email) throw new PartnerError("Enter a valid email address.", 400, "email");
  const phone = normalizePhone(cut(i.phone, 40));
  if (!phone) throw new PartnerError("Enter your phone or WhatsApp number.", 400, "phone");
  const city = cut(i.city, 80);
  if (!city) throw new PartnerError("Enter your city.", 400, "city");
  const country = cut(i.country, 80);
  if (!country) throw new PartnerError("Enter your country.", 400, "country");
  const kind = cut(i.professionKind, 30);
  if (!PROFESSION_LABEL[kind]) throw new PartnerError("Choose your profession.", 400, "professionKind");
  const company = cut(i.company, 160);
  const jobTitle = cut(i.jobTitle, 120);
  const other = cut(i.professionOther, 160);
  if (kind === "EMPLOYED" && (!company || !jobTitle)) throw new PartnerError("Tell us your company and job title.", 400, company ? "jobTitle" : "company");
  if (kind === "OTHER" && !other) throw new PartnerError("Tell us what you do.", 400, "professionOther");
  const typeKey = cut(i.typeKey, 20);
  if (!(INTEREST_KEYS as readonly string[]).includes(typeKey)) throw new PartnerError("Choose the type of partner you are applying as.", 400, "typeKey");
  const rawCodes = Array.isArray(i.solutionCodes) ? i.solutionCodes : typeof i.solutionCodes === "string" && i.solutionCodes ? [i.solutionCodes] : [];
  const known = new Set((await db.saasProduct.findMany({ where: { organizationId: p.organizationId, active: true }, select: { code: true } })).map((s) => s.code));
  const solutionCodes = [...new Set(rawCodes.map((c) => cut(c, 30)).filter((c) => known.has(c)))];
  if (solutionCodes.length === 0) throw new PartnerError("Choose at least one Solution you want to sell.", 400, "solutionCodes");
  if (i.terms !== true && i.terms !== "true" && i.terms !== "on") throw new PartnerError("Please accept the partner terms to apply.", 400, "terms");
  const data = {
    name, phone, city, country, professionKind: kind, company: kind === "EMPLOYED" ? company : null, jobTitle: kind === "EMPLOYED" ? jobTitle : null,
    professionOther: kind === "OTHER" ? other : null, solutionCodes, typeKey, salesExperience: cut(i.salesExperience, 1500) || null, networkSize: cut(i.networkSize, 300) || null,
    termsAcceptedAt: now, termsIp: clientIp(p.ip),
  };
  // Applying twice with the same email while the first is still waiting updates it instead of adding another
  const open = await db.partnerApplication.findFirst({ where: { organizationId: p.organizationId, email, status: "NEW" } });
  if (open) {
    await db.partnerApplication.update({ where: { id: open.id }, data: { ...data, submissions: { increment: 1 } } });
    return { ok: true as const, stored: true, duplicate: true };
  }
  const row = await db.partnerApplication.create({ data: { organizationId: p.organizationId, email, ...data } });
  await notifyMany(db, await usersWithPermission(db, p.organizationId, "partners.manage"), {
    kind: "partner.application", title: `New partner application: ${name}`, body: `${typeLabel(typeKey)} · ${city}, ${country}`, link: `/partner-stack?open=${row.id}`, dedupeKey: `partner-application:${row.id}`,
  });
  const types = await db.earnerType.findMany({ where: { organizationId: p.organizationId } });
  const names = await db.saasProduct.findMany({ where: { organizationId: p.organizationId, code: { in: solutionCodes } }, select: { name: true } });
  await sendTemplateQuietly(db, {
    organizationId: p.organizationId, key: "partner_application_received", to: email, relatedType: "PartnerApplication", relatedId: row.id,
    vars: { first_name: firstName(name), type: types.find((t) => t.key === typeKey)?.name ?? "Not sure yet", solutions: names.map((n) => n.name).join(", ") },
  });
  return { ok: true as const, stored: true, duplicate: false };
}

export const typeLabel = (key: string) => ({ REFERRAL: "Referral Partner", RESELLER: "Reseller Partner", EXCLUSIVE: "Exclusive Sales Partner", NOT_SURE: "Not sure yet", SALES_AGENT: "Sales Agent" } as Record<string, string>)[key] ?? key;

// ----- Review, approval -----

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomChars = (n: number) => Array.from(crypto.randomBytes(n), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
export const newPublicId = () => `HPS-${randomChars(4)}-${randomChars(4)}-${randomChars(2)}`;
export const newReferralCode = () => `HP-${randomChars(8)}`;

// The Partner ID: sequential per organization, given by the system at approval and never reused. Shown as HPS-0001.
export const partnerId = (n: number) => `HPS-${String(n).padStart(4, "0")}`;
// "HPS-0012", "hps-12" or "12" -> 12; anything else -> null. Used by search.
export function parsePartnerId(q: string): number | null {
  const m = /^(?:hps-?)?0*(\d{1,7})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}

export type ApprovalInput = {
  organizationId: string; applicationId: string; actorId: string; typeKey: string; ratePercent: string; durationMonths: string; leadSharing: boolean;
  territory?: string; solutionCodes: string[]; certifyCodes: string[]; now?: Date;
};

export async function approveApplication(db: Db, p: ApprovalInput) {
  const now = p.now ?? new Date();
  const app = await db.partnerApplication.findFirst({ where: { id: p.applicationId, organizationId: p.organizationId } });
  if (!app) throw new PartnerError("Application not found.", 404);
  if (app.status !== "NEW") throw new PartnerError(`This application was already ${app.status.toLowerCase()}.`);
  const type = await db.earnerType.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key: p.typeKey } } });
  if (!type || !type.active || p.typeKey === "SALES_AGENT") throw new PartnerError("Choose Referral, Reseller or Exclusive.", 400, "typeKey");
  const rate = cleanRate(p.ratePercent);
  const months = cleanDuration(p.durationMonths);
  const territory = (p.territory ?? "").trim().slice(0, 200) || null;
  const solutions = await db.saasProduct.findMany({ where: { organizationId: p.organizationId, code: { in: p.solutionCodes }, active: true } });
  if (solutions.length === 0) throw new PartnerError("Choose at least one Solution the partner may sell.", 400, "solutionCodes");
  const certify = solutions.filter((s) => p.certifyCodes.includes(s.code));
  if (await db.user.findFirst({ where: { email: app.email } })) throw new PartnerError("Someone already has an account with this email address.");
  if (await db.earner.findFirst({ where: { organizationId: p.organizationId, email: app.email } })) throw new PartnerError("This email is already a partner.");
  const settings = await getSettings(db, p.organizationId);

  const result = await db.$transaction(async (tx) => {
    // Lock the application row so two approvers cannot both approve it
    await tx.$queryRaw`SELECT id FROM "PartnerApplication" WHERE id = ${app.id} FOR UPDATE`;
    const fresh = await tx.partnerApplication.findUniqueOrThrow({ where: { id: app.id } });
    if (fresh.status !== "NEW") throw new PartnerError(`This application was already ${fresh.status.toLowerCase()}.`);
    // One approval at a time per organization while the next Partner ID is taken, so two approvals never get the same number
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"partner-number:" + p.organizationId}))`;
    const last = await tx.earner.aggregate({ where: { organizationId: p.organizationId }, _max: { partnerNumber: true } });
    const partnerNumber = (last._max.partnerNumber ?? 0) + 1;
    const user = await tx.user.create({
      data: { organizationId: p.organizationId, email: app.email, phone: null, name: app.name, passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10), userType: "PARTNER" },
    });
    let earner;
    for (let attempt = 0; ; attempt++) {
      try {
        earner = await tx.earner.create({
          data: {
            organizationId: p.organizationId, userId: user.id, typeId: type.id, partnerNumber, name: app.name, email: app.email, phone: app.phone, city: app.city, country: app.country,
            ratePercent: rate, durationMonths: months, leadSharing: p.leadSharing, territory, referralCode: newReferralCode(), applicationId: app.id,
            solutions: { create: solutions.map((s) => ({ productId: s.id })) },
          },
        });
        break;
      } catch (e) {
        if (attempt < 5 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target).includes("referralCode")) continue;
        throw e;
      }
    }
    const certs = [];
    for (const s of certify) certs.push(await issueCertificateTx(tx, { organizationId: p.organizationId, earnerId: earner.id, productId: s.id, days: certificateValidityDays(settings, s.code, earner.certExpiryDays), actorId: p.actorId, now }));
    await tx.partnerApplication.update({ where: { id: app.id }, data: { status: "APPROVED", decidedById: p.actorId, decidedAt: now, earnerId: earner.id } });
    return { user, earner, certs };
  });

  // Emails after the commit: a mail problem never undoes an approval
  const link = `${appUrl()}/reset/${await createResetLink(db, { organizationId: p.organizationId, userId: result.user.id, createdById: p.actorId, hours: 72 })}`;
  await sendTemplateQuietly(db, {
    organizationId: p.organizationId, key: "partner_approved", to: app.email, relatedType: "Earner", relatedId: result.earner.id, secret: true, buttonUrl: link,
    vars: { first_name: firstName(app.name), partner_id: partnerId(result.earner.partnerNumber), type: type.name, rate: `${rate}%`, duration: durationLabel(months), solutions: solutions.map((s) => s.name).join(", "), link, referral_code: result.earner.referralCode },
  });
  for (const c of result.certs) await emailCertificate(db, c.id);
  return { earnerId: result.earner.id, certificates: result.certs.length };
}

export async function rejectApplication(db: Db, p: { organizationId: string; applicationId: string; actorId: string; reason: string; now?: Date }) {
  const reason = p.reason.trim();
  if (reason.length < 3) throw new PartnerError("Write a short reason. It is sent to the applicant.", 400, "reason");
  if (reason.length > 600) throw new PartnerError("Keep the reason under 600 characters.", 400, "reason");
  const app = await db.partnerApplication.findFirst({ where: { id: p.applicationId, organizationId: p.organizationId } });
  if (!app) throw new PartnerError("Application not found.", 404);
  const done = await db.partnerApplication.updateMany({ where: { id: app.id, status: "NEW" }, data: { status: "REJECTED", decidedById: p.actorId, decidedAt: p.now ?? new Date(), decisionNote: reason } });
  if (done.count === 0) throw new PartnerError("This application was already decided.");
  await sendTemplateQuietly(db, { organizationId: p.organizationId, key: "partner_application_rejected", to: app.email, relatedType: "PartnerApplication", relatedId: app.id, vars: { first_name: firstName(app.name), note: reason } });
  return app;
}

export async function updateInquiry(db: Db, p: { organizationId: string; id: string; status: string; note: string; actorId: string }) {
  if (!(INQUIRY_STATUSES as readonly string[]).includes(p.status)) throw new PartnerError("Choose a status.");
  const row = await db.partnerInquiry.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!row) throw new PartnerError("Inquiry not found.", 404);
  const after = await db.partnerInquiry.update({ where: { id: row.id }, data: { status: p.status, note: p.note.trim().slice(0, 2000) || null, handledById: p.actorId, handledAt: new Date() } });
  return { before: row, after };
}

// Admin edits to an existing partner's terms (type, rate, duration, territory, lead sharing, Solutions, status).
export async function updateEarner(db: Db, p: { organizationId: string; earnerId: string; typeKey: string; ratePercent: string; durationMonths: string; leadSharing: boolean; territory: string; certExpiryDays: string; status: string; solutionCodes: string[] }) {
  const earner = await db.earner.findFirst({ where: { id: p.earnerId, organizationId: p.organizationId }, include: { solutions: true } });
  if (!earner) throw new PartnerError("Partner not found.", 404);
  const type = await db.earnerType.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key: p.typeKey } } });
  if (!type) throw new PartnerError("Choose a partner type.", 400, "typeKey");
  if (!["ACTIVE", "SUSPENDED"].includes(p.status)) throw new PartnerError("Choose a status.");
  const rate = cleanRate(p.ratePercent);
  const months = cleanDuration(p.durationMonths);
  const expiry = p.certExpiryDays.trim();
  if (expiry && (!/^\d{1,4}$/.test(expiry) || Number(expiry) < 1)) throw new PartnerError("Certificate validity: enter a whole number of days, or leave it empty for the default.", 400, "certExpiryDays");
  const products = await db.saasProduct.findMany({ where: { organizationId: p.organizationId, code: { in: p.solutionCodes } } });
  if (products.length === 0) throw new PartnerError("Choose at least one Solution.", 400, "solutionCodes");
  const after = await db.$transaction(async (tx) => {
    await tx.earnerSolution.deleteMany({ where: { earnerId: earner.id, productId: { notIn: products.map((x) => x.id) } } });
    await tx.earnerSolution.createMany({ data: products.map((x) => ({ earnerId: earner.id, productId: x.id })), skipDuplicates: true });
    const u = await tx.earner.update({
      where: { id: earner.id },
      data: { typeId: type.id, ratePercent: rate, durationMonths: months, leadSharing: p.leadSharing, territory: p.territory.trim().slice(0, 200) || null, certExpiryDays: expiry ? Number(expiry) : null, status: p.status },
    });
    if (earner.userId) {
      await tx.user.update({ where: { id: earner.userId }, data: { active: p.status === "ACTIVE" } });
      if (p.status !== "ACTIVE") await tx.session.updateMany({ where: { userId: earner.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return u;
  });
  return { before: earner, after };
}

// ----- Certificates -----

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function issueCertificateTx(tx: Tx | Db, p: { organizationId: string; earnerId: string; productId: string; days: number; actorId: string | null; now: Date }) {
  const expiresAt = new Date(p.now.getTime() + p.days * 86_400_000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.partnerCertificate.create({ data: { organizationId: p.organizationId, publicId: newPublicId(), earnerId: p.earnerId, productId: p.productId, issuedAt: p.now, expiresAt, issuedById: p.actorId } });
    } catch (e) {
      if (attempt < 5 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

export async function issueCertificate(db: Db, p: { organizationId: string; earnerId: string; solutionCode: string; actorId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const earner = await db.earner.findFirst({ where: { id: p.earnerId, organizationId: p.organizationId, status: "ACTIVE" }, include: { solutions: { include: { product: true } } } });
  if (!earner) throw new PartnerError("Partner not found or not active.", 404);
  const sol = earner.solutions.find((s) => s.product.code === p.solutionCode)?.product;
  if (!sol) throw new PartnerError("This partner is not approved for that Solution. Add it to their Solutions first.");
  const live = await db.partnerCertificate.findFirst({ where: { earnerId: earner.id, productId: sol.id, status: "ACTIVE", expiresAt: { gt: now } } });
  if (live) throw new PartnerError("This partner already holds a valid certificate for that Solution. Renew it instead.");
  const settings = await getSettings(db, p.organizationId);
  const cert = await issueCertificateTx(db, { organizationId: p.organizationId, earnerId: earner.id, productId: sol.id, days: certificateValidityDays(settings, sol.code, earner.certExpiryDays), actorId: p.actorId, now });
  await emailCertificate(db, cert.id);
  return cert;
}

// Renewing keeps the certificate id (so printed QR codes stay valid) and starts a fresh validity period from today.
export async function renewCertificate(db: Db, p: { organizationId: string; id: string; actorId: string; days?: string; now?: Date }) {
  const now = p.now ?? new Date();
  const cert = await db.partnerCertificate.findFirst({ where: { id: p.id, organizationId: p.organizationId }, include: { earner: true, product: true } });
  if (!cert) throw new PartnerError("Certificate not found.", 404);
  if (cert.status === "REVOKED") throw new PartnerError("A revoked certificate cannot be renewed. Issue a new one instead.");
  if (cert.earner.status !== "ACTIVE") throw new PartnerError("This partner is suspended.");
  const settings = await getSettings(db, p.organizationId);
  const custom = (p.days ?? "").trim();
  if (custom && (!/^\d{1,4}$/.test(custom) || Number(custom) < 1)) throw new PartnerError("Enter a whole number of days, or leave it empty for the default.");
  const days = custom ? Number(custom) : certificateValidityDays(settings, cert.product.code, cert.earner.certExpiryDays);
  const after = await db.partnerCertificate.update({
    where: { id: cert.id },
    data: { issuedAt: now, expiresAt: new Date(now.getTime() + days * 86_400_000), renewals: { increment: 1 }, firstReminderAt: null, finalReminderAt: null },
  });
  await emailCertificate(db, cert.id);
  return { before: cert, after };
}

export async function revokeCertificate(db: Db, p: { organizationId: string; id: string; actorId: string; reason: string; now?: Date }) {
  const reason = p.reason.trim();
  if (reason.length < 3) throw new PartnerError("Write the reason for revoking. It is kept in the record.", 400, "reason");
  const cert = await db.partnerCertificate.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!cert) throw new PartnerError("Certificate not found.", 404);
  if (cert.status === "REVOKED") throw new PartnerError("Already revoked.");
  const after = await db.partnerCertificate.update({ where: { id: cert.id }, data: { status: "REVOKED", revokedAt: p.now ?? new Date(), revokeReason: reason.slice(0, 600), revokedById: p.actorId } });
  return { before: cert, after };
}

export const certificateStatus = (c: { status: string; expiresAt: Date }, now = new Date()): "VALID" | "EXPIRED" | "REVOKED" =>
  c.status === "REVOKED" ? "REVOKED" : c.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "VALID";

export const verifyUrl = (publicId: string) => `${appUrl()}/partners/verify/${publicId}`;

export async function certificatePdfFor(db: Db, id: string, scope: { organizationId: string; earnerId?: string }) {
  const c = await db.partnerCertificate.findFirst({ where: { id, organizationId: scope.organizationId, ...(scope.earnerId ? { earnerId: scope.earnerId } : {}) }, include: { earner: { include: { type: true } }, product: true } });
  if (!c) return null;
  const org = await db.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true } });
  const settings = await getSettings(db, scope.organizationId);
  const bytes = await certificatePdf({
    design: isCertificateDesign(settings.cert_design) ? settings.cert_design : "modern",
    signatoryName: settings.cert_signatory_name, signatoryTitle: settings.cert_signatory_title,
    publicId: c.publicId, partnerId: partnerId(c.earner.partnerNumber), partnerName: c.earner.name, solutionName: c.product.name, partnerType: c.earner.type.name, issuedAt: c.issuedAt, expiresAt: c.expiresAt,
    verifyUrl: verifyUrl(c.publicId), company: org?.name ?? "Hifi Marketing and Technologies",
  });
  return { bytes, filename: `Hifi-Partner-Stack-${c.product.code}-${c.publicId}.pdf`, cert: c };
}

// A sample in the given design with example details (marked SAMPLE), for the design picker in settings. Null for an unknown design.
export async function samplePartnerCertificate(db: Db, organizationId: string, design: string) {
  if (!isCertificateDesign(design)) return null;
  const [org, settings] = await Promise.all([db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }), getSettings(db, organizationId)]);
  const issuedAt = new Date();
  return certificatePdf({
    design, signatoryName: settings.cert_signatory_name, signatoryTitle: settings.cert_signatory_title,
    publicId: "HPS-SAMP-LE00-00", partnerId: partnerId(1), partnerName: "Sample Partner Name", solutionName: "Agentify ERP", partnerType: "Reseller Partner",
    issuedAt, expiresAt: new Date(issuedAt.getTime() + certificateValidityDays(settings, "") * 86_400_000),
    verifyUrl: verifyUrl("HPS-SAMP-LE00-00"), company: org?.name ?? "Hifi Marketing and Technologies",
  });
}

const longDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Public-safe facts for the social image of a certificate (the same facts the verify page shows). Null when unknown. */
export async function socialCardFor(db: Db, publicId: string, now = new Date()) {
  const v = await verifyCertificate(db, publicId, now);
  if (!v) return null;
  const c = await db.partnerCertificate.findUnique({ where: { publicId }, select: { organizationId: true, earner: { select: { type: { select: { name: true } } } } } });
  const org = c ? await db.organization.findUnique({ where: { id: c.organizationId }, select: { name: true } }) : null;
  return {
    partnerName: v.partnerName, partnerId: v.partnerId, solutionName: v.solution, partnerType: c?.earner.type.name ?? "Partner", publicId: v.publicId,
    validUntil: longDay(v.expiresAt), status: v.status, company: org?.name ?? "Hifi Marketing and Technologies",
  };
}

/**
 * LinkedIn's "Add licence or certification" form, filled in. The expiry is left out on purpose: certificates are renewed
 * under the same ID, and the linked verify page always shows the current state. organizationId (the company page's
 * number) makes LinkedIn show the company logo; without it LinkedIn shows the name only.
 */
export function linkedInAddUrl(p: { solutionName: string; company: string; issuedAt: Date; publicId: string; linkedInCompanyId?: string }) {
  const q = new URLSearchParams({ startTask: "CERTIFICATION_NAME", name: `Hifi Partner Stack: Authorised Partner, ${p.solutionName}` });
  const companyId = (p.linkedInCompanyId ?? "").trim();
  if (/^\d{1,15}$/.test(companyId)) q.set("organizationId", companyId);
  else q.set("organizationName", p.company);
  q.set("issueYear", String(p.issuedAt.getUTCFullYear()));
  q.set("issueMonth", String(p.issuedAt.getUTCMonth() + 1));
  q.set("certUrl", verifyUrl(p.publicId));
  q.set("certId", p.publicId);
  return `https://www.linkedin.com/profile/add?${q.toString()}`;
}

export const linkedInShareUrl = (publicId: string) => `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: verifyUrl(publicId) }).toString()}`;

async function emailCertificate(db: Db, id: string) {
  try {
    const c = await db.partnerCertificate.findUniqueOrThrow({ where: { id }, include: { earner: true, product: true } });
    const pdf = await certificatePdfFor(db, id, { organizationId: c.organizationId });
    if (!pdf) return;
    const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const link = verifyUrl(c.publicId);
    await sendTemplateQuietly(db, {
      organizationId: c.organizationId, key: "partner_certificate", to: c.earner.email, relatedType: "PartnerCertificate", relatedId: c.id, buttonUrl: link,
      attachment: { filename: pdf.filename, content: Buffer.from(pdf.bytes), contentType: "application/pdf" },
      vars: { first_name: firstName(c.earner.name), solution: c.product.name, certificate_id: c.publicId, issued: day(c.issuedAt), expires: day(c.expiresAt), link },
    });
  } catch (e) {
    console.error("Certificate email was not sent:", e instanceof Error ? e.message : e);
  }
}

// Public: what anyone may learn from a certificate id. Nothing about earnings, contact details or other partners.
export async function verifyCertificate(db: Db, publicId: string, now = new Date()) {
  if (!/^HPS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(publicId)) return null;
  const c = await db.partnerCertificate.findUnique({ where: { publicId }, include: { earner: { select: { name: true, status: true, partnerNumber: true } }, product: { select: { name: true } } } });
  if (!c) return null;
  const status = c.earner.status !== "ACTIVE" && c.status !== "REVOKED" ? "REVOKED" : certificateStatus(c, now);
  return { publicId: c.publicId, partnerId: partnerId(c.earner.partnerNumber), partnerName: c.earner.name, solution: c.product.name, issuedAt: c.issuedAt, expiresAt: c.expiresAt, status, revokedAt: status === "REVOKED" ? (c.revokedAt ?? null) : null };
}

// Daily job: the first reminder (default 7 days before) and the final one (default 1 day). Each is sent once per validity period.
export async function sendCertificateReminders(db: Db, organizationId: string, now = new Date()) {
  const settings = await getSettings(db, organizationId);
  const first = positiveInt(settings.cert_first_reminder_days, 7, 365);
  const last = positiveInt(settings.cert_final_reminder_days, 1, 365);
  const certs = await db.partnerCertificate.findMany({
    where: { organizationId, status: "ACTIVE", expiresAt: { gt: now, lte: new Date(now.getTime() + first * 86_400_000) }, earner: { status: "ACTIVE" } },
    include: { earner: true, product: true },
  });
  let sent = 0;
  for (const c of certs) {
    const daysLeft = Math.max(1, Math.ceil((c.expiresAt.getTime() - now.getTime()) / 86_400_000));
    const isFinal = c.expiresAt.getTime() - now.getTime() <= last * 86_400_000;
    if (isFinal ? c.finalReminderAt : c.firstReminderAt) continue;
    await sendTemplateQuietly(db, {
      organizationId, key: "partner_certificate_reminder", to: c.earner.email, relatedType: "PartnerCertificate", relatedId: c.id, buttonUrl: `${appUrl()}/partner`,
      vars: { first_name: firstName(c.earner.name), solution: c.product.name, certificate_id: c.publicId, expires: c.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), days_left: String(daysLeft), link: `${appUrl()}/partner` },
    });
    // The final reminder also closes the first, so a short-lived certificate is not reminded twice at once
    await db.partnerCertificate.update({ where: { id: c.id }, data: isFinal ? { finalReminderAt: now, firstReminderAt: c.firstReminderAt ?? now } : { firstReminderAt: now } });
    await notifyMany(db, await usersWithPermission(db, organizationId, "partners.manage"), {
      kind: "partner.certificate_expiring", title: `${c.earner.name}'s ${c.product.name} certificate expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`, link: "/partner-stack/certificates", dedupeKey: `partner-cert-${isFinal ? "final" : "first"}:${c.id}:${c.expiresAt.toISOString().slice(0, 10)}`,
    });
    sent++;
  }
  return sent;
}
