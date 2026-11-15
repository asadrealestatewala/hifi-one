"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { createInvite } from "@/lib/portal";

export type InviteState = { link?: string; error?: string };

export async function inviteToPortal(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requirePermission("clients.edit");
  const rawEmail = String(formData.get("email") ?? "").trim();
  const email = rawEmail ? z.string().email().safeParse(rawEmail) : null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const clientId = String(formData.get("clientId") ?? "");
  if (email && !email.success) return { error: "Enter a valid email address." };
  try {
    const token = await createInvite(db, { organizationId: user.organizationId, clientId, email: email?.data ?? null, phone, createdById: user.id });
    await audit(user, { action: "client.portal_invite", entity: "Client", entityId: clientId, after: { email: email?.data ?? null, phone } });
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    return { link: `${origin}/invite/${token}` };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    throw e;
  }
}
