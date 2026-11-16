"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ResaleError, confirmPaymentNotice, rejectPaymentNotice } from "@/lib/partner-resale";

const BASE = "/finance/partner-payments";
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "saved" | "error", msg: string): never => redirect(`${BASE}?${kind}=${encodeURIComponent(msg)}`);

// Finance found the money in the bank: record the receipt against the invoice through the normal payment flow.
export async function confirmNoticeAction(formData: FormData): Promise<void> {
  const user = await requirePermission("finance.post");
  let msg = "";
  try {
    const { notice, payment } = await confirmPaymentNotice(db, { organizationId: user.organizationId, noticeId: str(formData, "noticeId"), actorId: user.id, bankAccountId: str(formData, "bankAccountId") });
    await audit(user, { action: "partner.payment_notice.confirm", entity: "PartnerPaymentNotice", entityId: notice.id, after: { paymentId: payment.id, receipt: payment.number, amount: String(notice.amount), currency: notice.currency } });
    msg = `Confirmed. Receipt ${payment.number} recorded and the partner was emailed.`;
  } catch (e) {
    if (e instanceof ResaleError) back("error", e.message);
    throw e;
  }
  revalidatePath(BASE);
  back("saved", msg);
}

export async function rejectNoticeAction(formData: FormData): Promise<void> {
  const user = await requirePermission("finance.post");
  try {
    const n = await rejectPaymentNotice(db, { organizationId: user.organizationId, noticeId: str(formData, "noticeId"), actorId: user.id, reason: str(formData, "reason") });
    await audit(user, { action: "partner.payment_notice.reject", entity: "PartnerPaymentNotice", entityId: n.id, after: { reason: str(formData, "reason").trim() } });
  } catch (e) {
    if (e instanceof ResaleError) back("error", e.message);
    throw e;
  }
  revalidatePath(BASE);
  back("saved", "Sent back to the partner with your reason.");
}
