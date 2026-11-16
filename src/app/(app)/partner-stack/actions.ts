"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError } from "@/lib/files";
import { DOCUMENT_LABEL, IdentityError, approvePayoutAccount, removePayoutAccount, reviewIdentity, saveIdentityDocument, submitIdentity } from "@/lib/partner-identity";
import { defaultStorage } from "@/lib/storage";
import {
  ACADEMY_TEST_SETTINGS, PartnerError, RESALE_SETTINGS, TYPE_KEYS, addPartner, approveApplication, issueCertificate, rejectApplication, renewCertificate, revokeCertificate, saveEarnerType, setDirectAccess, saveSettings, updateEarner, updateInquiry,
} from "@/lib/partner-stack";
import { ResaleError, addSchool, confirmCounts, createResaleDrafts, endSchool, enterCount, monthLabel, setResaleTerm } from "@/lib/partner-resale";
import { readDuration } from "./_components/Fields";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const list = (f: FormData, prefix: string) => [...f.keys()].filter((k) => k.startsWith(prefix) && f.get(k) === "on").map((k) => k.slice(prefix.length));
const go = (base: string, extra: string): never => redirect(`${base}${base.includes("?") ? "&" : "?"}${extra}`);
const fail = (base: string, e: unknown): never => {
  if (e instanceof PartnerError || e instanceof IdentityError || e instanceof FileError || e instanceof ResaleError) return go(base, `error=${encodeURIComponent(e.message)}`);
  throw e;
};

export async function approveApplicationAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack?open=${encodeURIComponent(id)}`;
  try {
    const sell = list(formData, "sell_");
    const r = await approveApplication(db, {
      organizationId: user.organizationId, applicationId: id, actorId: user.id, typeKey: str(formData, "typeKey"), ratePercent: str(formData, "ratePercent"),
      durationMonths: readDuration(formData), leadSharing: formData.get("leadSharing") === "on", territory: str(formData, "territory"),
      solutionCodes: sell, certifyCodes: list(formData, "cert_").filter((c) => sell.includes(c)),
    });
    await audit(user, { action: "partner.approve", entity: "PartnerApplication", entityId: id, after: { earnerId: r.earnerId, certificates: r.certificates, type: str(formData, "typeKey"), rate: str(formData, "ratePercent") } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack");
  go(base, "saved=Approved. The partner was emailed a link to set their password.");
}

export async function rejectApplicationAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack?open=${encodeURIComponent(id)}`;
  try {
    await rejectApplication(db, { organizationId: user.organizationId, applicationId: id, actorId: user.id, reason: str(formData, "reason") });
    await audit(user, { action: "partner.reject", entity: "PartnerApplication", entityId: id, after: { reason: str(formData, "reason").trim() } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack");
  go(base, "saved=Rejected. The applicant was emailed your reason.");
}

export async function updateInquiryAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/inquiries?open=${encodeURIComponent(id)}`;
  try {
    const { before, after } = await updateInquiry(db, { organizationId: user.organizationId, id, status: str(formData, "status"), note: str(formData, "note"), actorId: user.id });
    await audit(user, { action: "partner.inquiry.update", entity: "PartnerInquiry", entityId: id, before: { status: before.status }, after: { status: after.status } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/inquiries");
  go(base, "saved=Saved.");
}

export async function updatePartnerAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const { before, after } = await updateEarner(db, {
      organizationId: user.organizationId, earnerId: id, typeKey: str(formData, "typeKey"), ratePercent: str(formData, "ratePercent"), durationMonths: readDuration(formData),
      leadSharing: formData.get("leadSharing") === "on", territory: str(formData, "territory"), certExpiryDays: str(formData, "certExpiryDays"), status: str(formData, "status"), solutionCodes: list(formData, "sell_"),
    });
    await audit(user, {
      action: "partner.update", entity: "Earner", entityId: id,
      before: { typeId: before.typeId, rate: String(before.ratePercent), durationMonths: before.durationMonths, leadSharing: before.leadSharing, territory: before.territory, status: before.status },
      after: { typeId: after.typeId, rate: String(after.ratePercent), durationMonths: after.durationMonths, leadSharing: after.leadSharing, territory: after.territory, status: after.status },
    });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Saved.");
}

export async function issueCertificateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const cert = await issueCertificate(db, { organizationId: user.organizationId, earnerId: id, solutionCode: str(formData, "solutionCode"), kind: str(formData, "kind"), actorId: user.id });
    await audit(user, { action: "partner.certificate.issue", entity: "PartnerCertificate", entityId: cert.id, after: { publicId: cert.publicId, kind: cert.kind, earnerId: id } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Certificate issued and emailed.");
}

export async function directAccessAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const on = str(formData, "on") === "1";
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const { before, after } = await setDirectAccess(db, { organizationId: user.organizationId, earnerId: id, on, reason: str(formData, "reason"), actorId: user.id });
    await audit(user, { action: on ? "partner.direct_access.grant" : "partner.direct_access.remove", entity: "Earner", entityId: id, before: { directAccess: before.academyDirectAccess }, after: { directAccess: after.academyDirectAccess, reason: after.directAccessReason } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, on ? "saved=Direct access granted. You can now issue the certificate of authorisation by hand." : "saved=Direct access removed. The partner earns the certificate of authorisation through the final test.");
}

export async function renewCertificateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = "/partner-stack/certificates";
  try {
    const { before, after } = await renewCertificate(db, { organizationId: user.organizationId, id, actorId: user.id, days: str(formData, "days") });
    await audit(user, { action: "partner.certificate.renew", entity: "PartnerCertificate", entityId: id, before: { expiresAt: before.expiresAt }, after: { expiresAt: after.expiresAt } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Certificate renewed and emailed.");
}

export async function revokeCertificateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = "/partner-stack/certificates";
  try {
    const { after } = await revokeCertificate(db, { organizationId: user.organizationId, id, actorId: user.id, reason: str(formData, "reason") });
    await audit(user, { action: "partner.certificate.revoke", entity: "PartnerCertificate", entityId: id, after: { reason: after.revokeReason } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Certificate revoked.");
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.settings");
  const base = "/partner-stack/settings";
  try {
    const values: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string" && (k.startsWith("cert_") || k.startsWith("calculator_") || k === "terms_text" || k === "linkedin_company_id" || k in ACADEMY_TEST_SETTINGS || k in RESALE_SETTINGS)) values[k] = v;
    const clean = await saveSettings(db, { organizationId: user.organizationId, actorId: user.id, values });
    await audit(user, { action: "partner.settings", entity: "PartnerSetting", after: { ...clean, terms_text: clean.terms_text ? "(changed)" : undefined } });
    for (const key of TYPE_KEYS) {
      if (!formData.has(`rate_${key}`)) continue;
      const { before, after } = await saveEarnerType(db, {
        organizationId: user.organizationId, key, rate: str(formData, `rate_${key}`), durationMonths: str(formData, `months_${key}`), leadSharing: formData.get(`lead_${key}`) === "on",
        publicOffer: formData.get(`public_${key}`) === "on", active: formData.get(`active_${key}`) === "on", academyRequired: formData.get(`academyreq_${key}`) === "on",
      });
      await audit(user, { action: "partner.type.update", entity: "EarnerType", entityId: after.id, before: { rate: String(before.defaultRate), months: before.defaultDurationMonths }, after: { rate: String(after.defaultRate), months: after.defaultDurationMonths, academyRequired: after.academyRequired } });
    }
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Settings saved.");
}

// Staff add a partner straight away (from an inquiry, or after a call or meeting) with the terms agreed with them.
export async function addPartnerAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const inquiryId = str(formData, "inquiryId") || undefined;
  // On a mistake the form comes back with what was typed, so nothing has to be entered twice
  const keep = new URLSearchParams({ new: "1", ...(inquiryId ? { inquiry: inquiryId } : {}) });
  for (const k of ["name", "email", "phone", "city", "country", "territory", "typeKey", "ratePercent", "trainingReason"]) if (str(formData, k)) keep.set(`f_${k}`, str(formData, k).slice(0, 300));
  const sells = list(formData, "sell_");
  if (sells.length) keep.set("f_sell", sells.join(","));
  if (formData.get("trainingOptional") === "on") keep.set("f_optional", "1");
  if (formData.get("leadSharing") === "on") keep.set("f_lead", "1");
  const base = `/partner-stack/partners?${keep.toString()}`;
  let id = "";
  try {
    const optional = formData.get("trainingOptional") === "on";
    const e = await addPartner(db, {
      organizationId: user.organizationId, actorId: user.id, inquiryId, name: str(formData, "name"), email: str(formData, "email"), phone: str(formData, "phone"), city: str(formData, "city"), country: str(formData, "country"),
      typeKey: str(formData, "typeKey"), ratePercent: str(formData, "ratePercent"), durationMonths: readDuration(formData), leadSharing: formData.get("leadSharing") === "on", territory: str(formData, "territory"),
      solutionCodes: list(formData, "sell_"), trainingOptional: optional, trainingReason: str(formData, "trainingReason"),
    });
    id = e.id;
    await audit(user, { action: "partner.add", entity: "Earner", entityId: e.id, after: { partnerNumber: e.partnerNumber, inquiryId: inquiryId ?? null, type: str(formData, "typeKey"), rate: String(e.ratePercent), trainingOptional: optional, reason: optional ? e.directAccessReason : undefined } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  revalidatePath("/partner-stack/inquiries");
  go(`/partner-stack/partners?open=${encodeURIComponent(id)}`, "saved=Partner added. They were emailed a link to set their own password.");
}

// Staff enter identity details for a partner who sent them by email or in person. Same rules and review as the partner's own form;
// the person who enters them should not be the one who verifies them.
export async function staffIdentityAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.view_identity");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  const uploaded: string[] = [];
  try {
    const earner = await db.earner.findFirst({ where: { id, organizationId: user.organizationId }, select: { id: true } });
    if (!earner) throw new PartnerError("Partner not found.", 404);
    for (const key of Object.keys(DOCUMENT_LABEL)) {
      const file = formData.get(`doc_${key}`);
      if (!(file instanceof File) || file.size === 0) continue;
      await saveIdentityDocument(db, defaultStorage(), { actor: toFileActor(user), earnerId: earner.id, category: key, name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
      uploaded.push(DOCUMENT_LABEL[key]);
    }
    const { after } = await submitIdentity(db, {
      organizationId: user.organizationId, earnerId: earner.id, actorId: user.id, byStaff: true,
      input: { legalName: str(formData, "legalName"), idType: str(formData, "idType"), idNumber: str(formData, "idNumber"), businessName: str(formData, "businessName"), ntn: str(formData, "ntn"), secpNumber: str(formData, "secpNumber"), activeTaxpayer: formData.get("activeTaxpayer") === "on", address: str(formData, "address") },
    });
    await audit(user, { action: "partner.identity.submit_by_staff", entity: "Earner", entityId: id, after: { status: after.status, idType: after.idType, documents: uploaded } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Identity details saved and waiting for review.");
}

export async function reviewIdentityAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.view_identity");
  const id = str(formData, "id");
  const decision = str(formData, "decision") === "VERIFY" ? "VERIFY" : "REJECT";
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const { before, after } = await reviewIdentity(db, { organizationId: user.organizationId, earnerId: id, actorId: user.id, decision, reason: str(formData, "reason") });
    await audit(user, { action: decision === "VERIFY" ? "partner.identity.verify" : "partner.identity.reject", entity: "Earner", entityId: id, before: { status: before.status }, after: { status: after.status, reason: after.rejectReason ?? undefined } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, decision === "VERIFY" ? "saved=Identity verified. The partner was emailed." : "saved=Sent back to the partner with your reason.");
}

export async function approvePayoutAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.view_identity");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const a = await approvePayoutAccount(db, { organizationId: user.organizationId, earnerId: id, accountId: str(formData, "accountId"), actorId: user.id });
    await audit(user, { action: "partner.payout.approve", entity: "PartnerPayoutAccount", entityId: a.id, after: { method: a.method, last4: a.accountLast4, reason: str(formData, "reason").trim() } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Payout account approved.");
}

export async function staffRemovePayoutAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const a = await removePayoutAccount(db, { organizationId: user.organizationId, earnerId: id, accountId: str(formData, "accountId"), actorId: user.id });
    await audit(user, { action: "partner.payout.remove_by_staff", entity: "PartnerPayoutAccount", entityId: a.id, after: { method: a.method, last4: a.accountLast4, reason: str(formData, "reason").trim() } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Payout account removed.");
}

// ----- Reseller partners, step 2: resale terms, schools, counts and monthly drafts -----

export async function setResaleTermAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const t = await setResaleTerm(db, {
      organizationId: user.organizationId, earnerId: id, productCode: str(formData, "productCode"), actorId: user.id,
      input: { model: str(formData, "model"), collection: str(formData, "collection"), unitName: str(formData, "unitName") || "student", currency: str(formData, "currency") || "PKR", wholesalePrice: str(formData, "wholesalePrice"), resalePrice: str(formData, "resalePrice"), paymentTermsDays: str(formData, "paymentTermsDays") || "10", effectiveFrom: str(formData, "effectiveFrom"), note: str(formData, "note") },
    });
    await audit(user, { action: "partner.resale_terms", entity: "PartnerResaleTerm", entityId: t.id, after: { earnerId: id, product: str(formData, "productCode"), model: t.model, collection: t.collection, currency: t.currency, wholesale: String(t.wholesalePrice), resale: t.resalePrice ? String(t.resalePrice) : null, from: t.effectiveFrom, days: t.paymentTermsDays } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=Selling terms saved.#resale");
}

export async function staffAddSchoolAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const s = await addSchool(db, { organizationId: user.organizationId, earnerId: id, actorId: user.id, byStaff: true, input: { productCode: str(formData, "productCode"), name: str(formData, "name"), email: str(formData, "email"), phone: str(formData, "phone"), city: str(formData, "city"), startMonth: str(formData, "startMonth") } });
    await audit(user, { action: "partner.school.add", entity: "ResaleSchool", entityId: s.id, after: { earnerId: id, clientId: s.clientId, startMonth: s.startMonth } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=School added.#resale");
}

export async function staffEndSchoolAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  const base = `/partner-stack/partners?open=${encodeURIComponent(id)}`;
  try {
    const s = await endSchool(db, { organizationId: user.organizationId, earnerId: id, schoolId: str(formData, "schoolId"), actorId: user.id });
    await audit(user, { action: "partner.school.end", entity: "ResaleSchool", entityId: s.id, after: { reason: str(formData, "reason").trim() } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/partners");
  go(base, "saved=School removed. It stays a Hifi client; months already used are still billed.#resale");
}

export async function staffEnterCountAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const month = str(formData, "month");
  const base = `/partner-stack/resale?month=${encodeURIComponent(month)}`;
  try {
    const { before, after } = await enterCount(db, { organizationId: user.organizationId, earnerId: str(formData, "earnerId"), schoolId: str(formData, "schoolId"), month, units: str(formData, "units"), actorId: user.id, byStaff: true });
    await audit(user, { action: "partner.count.enter", entity: "ResaleCount", entityId: after.id, before: before ? { units: before.units } : undefined, after: { units: after.units, month } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/resale");
  go(base, "saved=Count saved and confirmed.");
}

export async function confirmCountsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const month = str(formData, "month");
  const base = `/partner-stack/resale?month=${encodeURIComponent(month)}`;
  const ids = formData.getAll("countId").map(String).filter(Boolean);
  let n = 0;
  try {
    n = await confirmCounts(db, { organizationId: user.organizationId, countIds: ids, actorId: user.id });
    await audit(user, { action: "partner.count.confirm", entity: "ResaleCount", after: { month, confirmed: n } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/resale");
  go(base, `saved=${encodeURIComponent(`${n} count${n === 1 ? "" : "s"} confirmed.`)}`);
}

export async function createDraftsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const month = str(formData, "month");
  const base = `/partner-stack/resale?month=${encodeURIComponent(month)}`;
  let msg = "";
  try {
    const r = await createResaleDrafts(db, { organizationId: user.organizationId, month, actorId: user.id });
    await audit(user, { action: "partner.resale.drafts", entity: "Invoice", after: { month, ...r, missing: r.missing.length } });
    msg = `${r.invoices} draft invoice${r.invoices === 1 ? "" : "s"} made for ${monthLabel(month)} (${r.partnerInvoices} to partners, ${r.schoolInvoices} to schools).`;
    if (r.unconfirmed) msg += ` ${r.unconfirmed} count${r.unconfirmed === 1 ? " is" : "s are"} not confirmed yet.`;
    if (r.missing.length) msg += ` ${r.missing.length} school${r.missing.length === 1 ? " has" : "s have"} no count.`;
    if (r.invoices) msg += " Finance reviews and issues them under Billing → Invoices.";
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/resale");
  go(base, `saved=${encodeURIComponent(msg)}`);
}
