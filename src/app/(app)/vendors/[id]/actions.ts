"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { createVendorInvite } from "@/lib/portal";
import { VendorError, setVendorStatus } from "@/lib/vendors";

export type VendorInviteState = { link?: string; error?: string };

export async function inviteVendor(_prev: VendorInviteState, formData: FormData): Promise<VendorInviteState> {
  const user = await requirePermission("vendors.manage");
  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const vendorId = String(formData.get("vendorId") ?? "");
  try {
    const token = await createVendorInvite(db, { organizationId: user.organizationId, vendorId, email: email.data, createdById: user.id });
    await audit(user, { action: "vendor.portal_invite", entity: "Vendor", entityId: vendorId, after: { email: email.data } });
    const h = await headers();
    return { link: `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/invite/${token}` };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    throw e;
  }
}

export async function changeStatus(formData: FormData) {
  const user = await requirePermission("vendors.manage");
  const vendorId = String(formData.get("vendorId"));
  const status = z.enum(["APPROVED", "SUSPENDED"]).safeParse(formData.get("status"));
  if (!status.success) return;
  try {
    await setVendorStatus(db, { organizationId: user.organizationId, vendorId, status: status.data });
    await audit(user, { action: `vendor.${status.data.toLowerCase()}`, entity: "Vendor", entityId: vendorId });
  } catch (e) {
    if (!(e instanceof VendorError)) throw e;
  }
  revalidatePath(`/vendors/${vendorId}`);
}
