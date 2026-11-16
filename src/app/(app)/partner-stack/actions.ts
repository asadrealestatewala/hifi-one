"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError } from "@/lib/files";
import { DOCUMENT_LABEL, IdentityError, approvePayoutAccount, removePayoutAccount, reviewIdentity, saveIdentityDocument, submitIdentity } from "@/lib/partner-identity";
import { defaultStorage } from "@/lib/storage";
import {
  ACADEMY_TEST_SETTINGS, PartnerError, TYPE_KEYS, addPartner, approveApplication, issueCertificate, rejectApplication, renewCertificate, revokeCertificate, saveEarnerType, setDirectAccess, saveSettings, updateEarner, updateInquiry,
} from "@/lib/partner-stack";
import { readDuration } from "./_components/Fields";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const list = (f: FormData, prefix: string) => [...f.keys()].filter((k) => k.startsWith(prefix) && f.get(k) === "on").map((k) => k.slice(prefix.length));
const go = (base: string, extra: string): never => redirect(`${base}${base.includes("?") ? "&" : "?"}${extra}`);
const fail = (base: string, e: unknown): never => {
  if (e instanceof PartnerError || e instanceof IdentityError || e instanceof FileError) return go(base, `error=${encodeURIComponent(e.message)}`);
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
    for (const [k, v] of formData.entries()) if (typeof v === "string" && (k.startsWith("cert_") || k.startsWith("calculator_") || k === "terms_text" || k === "linkedin_company_id" || k in ACADEMY_TEST_SETTINGS)) values[k] = v;
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
