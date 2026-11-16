"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePartnerUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError } from "@/lib/files";
import { ResaleError, submitPaymentNotice } from "@/lib/partner-resale";
import { defaultStorage } from "@/lib/storage";

const BASE = "/partner/invoices";
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "saved" | "error", msg: string, hash = ""): never => redirect(`${BASE}?${kind}=${encodeURIComponent(msg)}${hash}`);

// "I've paid": the partner reports a transfer to Hifi's account with the receipt. Finance checks the bank and confirms it;
// until then the invoice stays unpaid.
export async function reportPaymentAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  const invoiceId = str(formData, "invoiceId");
  try {
    const file = formData.get("receipt");
    const n = await submitPaymentNotice(db, defaultStorage(), {
      actor: toFileActor(user), earnerId: earner.id, invoiceId, amount: str(formData, "amount"), paidOn: str(formData, "paidOn"), reference: str(formData, "reference"),
      file: file instanceof File && file.size > 0 ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) } : null,
    });
    await audit(user, { action: "partner.payment_notice", entity: "PartnerPaymentNotice", entityId: n.id, after: { invoiceId, amount: String(n.amount), currency: n.currency, reference: n.reference } });
  } catch (e) {
    if (e instanceof ResaleError || e instanceof FileError) back("error", e.message, `#inv-${invoiceId}`);
    throw e;
  }
  revalidatePath(BASE);
  back("saved", "Thank you. Hifi will check the payment and email you once it is confirmed.");
}
