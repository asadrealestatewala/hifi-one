"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { RemovalError, deleteClient, nameMatches, setClientActive } from "@/lib/record-removal";

// Mark a client inactive (the archive for clients), bring it back, or delete a test client for good. Needs "records.delete".
const back = (id: string, key: "error" | "removed", text: string): never => redirect(`/clients/${id}?${key}=${encodeURIComponent(text)}`);

export async function setClientActiveAction(formData: FormData): Promise<void> {
  const user = await requirePermission("records.delete");
  const clientId = String(formData.get("clientId") ?? "");
  const active = formData.get("active") === "1";
  let before: boolean;
  try {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: user.organizationId }, select: { active: true } });
    if (!c) return back(clientId, "error", "Client not found.");
    before = c.active;
    await setClientActive(db, user.organizationId, clientId, active);
  } catch (e) {
    if (e instanceof RemovalError) return back(clientId, "error", e.message);
    throw e;
  }
  if (before !== active) await audit(user, { action: active ? "client.restore" : "client.archive", entity: "Client", entityId: clientId, before: { active: before }, after: { active } });
  revalidatePath("/clients");
  back(clientId, "removed", active ? "Client is active again." : "Client marked inactive. It only shows under Inactive in the client list.");
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const user = await requirePermission("records.delete");
  const clientId = String(formData.get("clientId") ?? "");
  const client = await db.client.findFirst({ where: { id: clientId, organizationId: user.organizationId } });
  if (!client) return back(clientId, "error", "Client not found.");
  if (!nameMatches(formData.get("confirmName"), client.name)) return back(client.id, "error", "The name you typed did not match, so nothing was deleted.");
  try {
    await deleteClient(db, user.organizationId, client.id);
  } catch (e) {
    if (e instanceof RemovalError) return back(client.id, "error", e.message);
    throw e;
  }
  await audit(user, { action: "client.delete", entity: "Client", entityId: client.id, before: { code: client.code, name: client.name, email: client.email, active: client.active }, after: null });
  revalidatePath("/clients");
  redirect(`/clients?deleted=${encodeURIComponent(client.name)}`);
}
