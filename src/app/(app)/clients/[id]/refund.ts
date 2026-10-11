"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { refundAdvance } from "@/lib/bookkeeping";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";

export async function refundAction(formData: FormData) {
  const user = await requirePermission("finance.refund");
  const clientId = String(formData.get("clientId"));
  try {
    const e = await refundAdvance(db, {
      organizationId: user.organizationId, clientId, bankAccountId: String(formData.get("bankAccountId")), amount: String(formData.get("amount") ?? ""),
      reason: String(formData.get("reason") ?? ""), actorId: user.id, idempotencyKey: String(formData.get("key")),
    });
    await audit(user, { action: "refund.issue", entity: "Client", entityId: clientId, after: { entry: e.number } });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/clients/${clientId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/clients/${clientId}`);
}
