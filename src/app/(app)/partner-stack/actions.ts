"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PartnerError, approveApplication, issueCertificate, rejectApplication, renewCertificate, revokeCertificate, saveEarnerType, saveSettings, updateEarner, updateInquiry,
} from "@/lib/partner-stack";
import { readDuration } from "./_components/Fields";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const list = (f: FormData, prefix: string) => [...f.keys()].filter((k) => k.startsWith(prefix) && f.get(k) === "on").map((k) => k.slice(prefix.length));
const go = (base: string, extra: string): never => redirect(`${base}${base.includes("?") ? "&" : "?"}${extra}`);
const fail = (base: string, e: unknown): never => {
  if (e instanceof PartnerError) return go(base, `error=${encodeURIComponent(e.message)}`);
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
    for (const [k, v] of formData.entries()) if (typeof v === "string" && (k.startsWith("cert_") || k.startsWith("calculator_") || k === "terms_text" || k === "linkedin_company_id")) values[k] = v;
    const clean = await saveSettings(db, { organizationId: user.organizationId, actorId: user.id, values });
    await audit(user, { action: "partner.settings", entity: "PartnerSetting", after: { ...clean, terms_text: clean.terms_text ? "(changed)" : undefined } });
    for (const key of ["REFERRAL", "RESELLER", "EXCLUSIVE", "SALES_AGENT"]) {
      if (!formData.has(`rate_${key}`)) continue;
      const { before, after } = await saveEarnerType(db, {
        organizationId: user.organizationId, key, rate: str(formData, `rate_${key}`), durationMonths: str(formData, `months_${key}`), leadSharing: formData.get(`lead_${key}`) === "on",
        publicOffer: formData.get(`public_${key}`) === "on", active: formData.get(`active_${key}`) === "on",
      });
      await audit(user, { action: "partner.type.update", entity: "EarnerType", entityId: after.id, before: { rate: String(before.defaultRate), months: before.defaultDurationMonths }, after: { rate: String(after.defaultRate), months: after.defaultDurationMonths } });
    }
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Settings saved.");
}
