"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { INTEGRATIONS, IntegrationKeyError, clearKey, isProvider, setKey } from "@/lib/integration-keys";

const BASE = "/settings/integrations";
const flash = (kind: "error" | "ok", m: string): never => redirect(`${BASE}?${kind}=${encodeURIComponent(m)}`);

export async function saveIntegrationKey(formData: FormData): Promise<void> {
  // Super Admin only: the permission is held by that role alone, and the role is checked again here
  const user = await requirePermission("integrations.manage");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const provider = String(formData.get("provider") ?? "");
  if (!isProvider(provider)) return flash("error", "Unknown service.");
  try {
    const r = await setKey(db, { organizationId: user.organizationId, provider, value: String(formData.get("value") ?? ""), userId: user.id });
    // The audit entry names the service and the last 4 characters only, never the key
    await audit(user, { action: "integration.key.set", entity: "IntegrationKey", entityId: provider, after: { provider, hint: r.hint } });
  } catch (e) {
    if (e instanceof IntegrationKeyError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", `${INTEGRATIONS[provider].label} key saved.`);
}

export async function clearIntegrationKey(formData: FormData): Promise<void> {
  // Super Admin only: the permission is held by that role alone, and the role is checked again here
  const user = await requirePermission("integrations.manage");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const provider = String(formData.get("provider") ?? "");
  if (!isProvider(provider)) return flash("error", "Unknown service.");
  const n = await clearKey(db, { organizationId: user.organizationId, provider });
  if (n > 0) await audit(user, { action: "integration.key.clear", entity: "IntegrationKey", entityId: provider, after: { provider } });
  return flash("ok", n > 0 ? `${INTEGRATIONS[provider].label} key removed from the app.` : "There was no key saved in the app.");
}
