"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePartnerUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError } from "@/lib/files";
import { DOCUMENT_LABEL, IdentityError, addPayoutAccount, removePayoutAccount, saveIdentityDocument, setDefaultPayoutAccount, submitIdentity } from "@/lib/partner-identity";
import { defaultStorage } from "@/lib/storage";

const BASE = "/partner/details";
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "saved" | "error", msg: string, hash = ""): never => redirect(`${BASE}?${kind}=${encodeURIComponent(msg)}${hash}`);
const failed = (e: unknown, hash: string): never => {
  if (e instanceof IdentityError || e instanceof FileError) return back("error", e.message, hash);
  throw e;
};

// The partner sends (or corrects) their identity details with the ID pictures. Pictures are saved first, then the details are
// checked; a missing picture is reported without losing the ones already uploaded.
export async function submitIdentityAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  const uploaded: string[] = [];
  try {
    for (const key of Object.keys(DOCUMENT_LABEL)) {
      const file = formData.get(`doc_${key}`);
      if (!(file instanceof File) || file.size === 0) continue;
      await saveIdentityDocument(db, defaultStorage(), { actor: toFileActor(user), earnerId: earner.id, category: key, name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
      uploaded.push(DOCUMENT_LABEL[key]);
    }
    const { before, after } = await submitIdentity(db, {
      organizationId: user.organizationId, earnerId: earner.id, actorId: user.id, byStaff: false,
      input: { legalName: str(formData, "legalName"), idType: str(formData, "idType"), idNumber: str(formData, "idNumber"), businessName: str(formData, "businessName"), ntn: str(formData, "ntn"), secpNumber: str(formData, "secpNumber"), activeTaxpayer: formData.get("activeTaxpayer") === "on", address: str(formData, "address") },
    });
    // Never the ID number itself in the audit log
    await audit(user, { action: "partner.identity.submit", entity: "Earner", entityId: earner.id, before: before ? { status: before.status, idType: before.idType } : undefined, after: { status: after.status, idType: after.idType, documents: uploaded } });
  } catch (e) {
    if (uploaded.length && e instanceof IdentityError) await audit(user, { action: "partner.identity.documents", entity: "Earner", entityId: earner.id, after: { documents: uploaded } });
    failed(e, "#identity");
  }
  revalidatePath(BASE);
  back("saved", "Thank you. Your details were sent to Hifi for checking. We will email you the result.", "#identity");
}

export async function addPayoutAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  try {
    const a = await addPayoutAccount(db, {
      organizationId: user.organizationId, earnerId: earner.id, actorId: user.id, byStaff: false,
      input: { method: str(formData, "method"), otherName: str(formData, "otherName"), bankName: str(formData, "bankName"), accountTitle: str(formData, "accountTitle"), account: str(formData, "account"), makeDefault: formData.get("makeDefault") === "on" },
    });
    await audit(user, { action: "partner.payout.add", entity: "PartnerPayoutAccount", entityId: a.id, after: { method: a.method, last4: a.accountLast4, titleMatches: a.titleMatches, usableFrom: a.usableFrom } });
  } catch (e) { failed(e, "#payouts"); }
  revalidatePath(BASE);
  back("saved", "Payout account saved. For your safety it can be used after 48 hours, and we emailed you about it.", "#payouts");
}

export async function removePayoutAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  try {
    const a = await removePayoutAccount(db, { organizationId: user.organizationId, earnerId: earner.id, accountId: str(formData, "id"), actorId: user.id });
    await audit(user, { action: "partner.payout.remove", entity: "PartnerPayoutAccount", entityId: a.id, after: { method: a.method, last4: a.accountLast4 } });
  } catch (e) { failed(e, "#payouts"); }
  revalidatePath(BASE);
  back("saved", "Payout account removed.", "#payouts");
}

export async function defaultPayoutAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  try {
    const a = await setDefaultPayoutAccount(db, { organizationId: user.organizationId, earnerId: earner.id, accountId: str(formData, "id") });
    await audit(user, { action: "partner.payout.default", entity: "PartnerPayoutAccount", entityId: a.id, after: { method: a.method, last4: a.accountLast4 } });
  } catch (e) { failed(e, "#payouts"); }
  revalidatePath(BASE);
  back("saved", "Default payout account changed.", "#payouts");
}
