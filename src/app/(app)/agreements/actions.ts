"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { AgreementError, createAgreement, editAgreement, saveTemplate, sendAgreement, voidAgreement } from "@/lib/agreements";
import { db } from "@/lib/db";

export type SendState = { error?: string; token?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function saveTemplateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("contracts.manage");
  try {
    const t = await saveTemplate(db, { organizationId: user.organizationId, id: s(formData, "id") || undefined, name: s(formData, "name"), kind: s(formData, "kind"), body: s(formData, "body"), active: s(formData, "id") ? formData.getAll("active").includes("1") : undefined });
    await audit(user, { action: "agreement.template_save", entity: "DocumentTemplate", entityId: t.id, after: { name: t.name } });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/agreements?tab=templates&new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/agreements");
  redirect("/agreements?tab=templates");
}

export async function createAgreementAction(formData: FormData): Promise<void> {
  const user = await requirePermission("contracts.manage");
  const party = s(formData, "party"); // "client:<id>" or "vendor:<id>"
  const [kind, partyId] = party.split(":");
  let id: string;
  try {
    const a = await createAgreement(db, {
      organizationId: user.organizationId, actorId: user.id, title: s(formData, "title"), body: s(formData, "body"), templateId: s(formData, "templateId") || null,
      clientId: kind === "client" ? partyId : null, vendorId: kind === "vendor" ? partyId : null, amount: s(formData, "amount"), startDate: s(formData, "startDate"), endDate: s(formData, "endDate"),
    });
    id = a.id;
    await audit(user, { action: "agreement.create", entity: "Agreement", entityId: a.id, after: { number: a.number, title: a.title } });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/agreements?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/agreements/${id}`);
}

export async function editAgreementAction(formData: FormData): Promise<void> {
  const user = await requirePermission("contracts.manage");
  const id = s(formData, "id");
  try {
    await editAgreement(db, { organizationId: user.organizationId, id, title: s(formData, "title"), body: s(formData, "body") });
    await audit(user, { action: "agreement.edit", entity: "Agreement", entityId: id });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/agreements/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/agreements/${id}`);
  redirect(`/agreements/${id}`);
}

// The signing link is returned once, in the response to this action, and only its hash is stored.
export async function sendAgreementAction(_prev: SendState, formData: FormData): Promise<SendState> {
  const user = await requirePermission("contracts.manage");
  const id = s(formData, "id");
  try {
    const token = await sendAgreement(db, { organizationId: user.organizationId, id, signerName: s(formData, "signerName"), signerEmail: s(formData, "signerEmail") });
    await audit(user, { action: "agreement.send", entity: "Agreement", entityId: id, after: { signer: s(formData, "signerName") } });
    revalidatePath(`/agreements/${id}`);
    return { token };
  } catch (e) {
    if (e instanceof AgreementError) return { error: e.message };
    throw e;
  }
}

export async function voidAgreementAction(formData: FormData): Promise<void> {
  const user = await requirePermission("contracts.manage");
  const id = s(formData, "id");
  try {
    await voidAgreement(db, { organizationId: user.organizationId, id });
    await audit(user, { action: "agreement.void", entity: "Agreement", entityId: id });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/agreements/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/agreements/${id}`);
  redirect(`/agreements/${id}`);
}
