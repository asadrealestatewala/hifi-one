"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AssetError, CONDITION_LABEL, WRITE_OFF_LABEL, acknowledgeItem, issueItem, recordItem, returnItem, updateItem, writeOffItem } from "@/lib/asset-custody";
import { RequestError } from "@/lib/employee-requests";
import { getBaseCurrency } from "@/lib/fx";
import { notify } from "@/lib/notifications";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// Only paths inside the app; the message is added to whatever query the page already had.
const safe = (p: string, fallback: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p.replace(/[&?](error|msg)=[^&]*/g, "") : fallback);
const go = (to: string, k: "error" | "msg", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
const fail = (to: string, e: unknown) => {
  if (e instanceof AssetError || e instanceof RequestError) go(to, "error", e.message);
  throw e;
};
const refresh = (assetId?: string) => {
  revalidatePath("/hr/assets");
  if (assetId) revalidatePath(`/hr/assets/${assetId}`);
  revalidatePath("/me/profile");
};

// HR records an item that is not bought through the books.
export async function recordItemAction(formData: FormData): Promise<void> {
  const user = await requirePermission("assets.custody");
  let id = "";
  try {
    const a = await recordItem(db, {
      organizationId: user.organizationId, actorId: user.id, name: str(formData, "name"), category: str(formData, "category"), serialNumber: str(formData, "serialNumber"),
      condition: str(formData, "condition"), location: str(formData, "location"), notes: str(formData, "notes"), purchaseDate: str(formData, "purchaseDate"), cost: str(formData, "cost"),
      currency: await getBaseCurrency(db, user.organizationId),
    });
    id = a.id;
    await audit(user, { action: "asset.record", entity: "Asset", entityId: a.id, after: { number: a.number, name: a.name, category: a.category, inBooks: false } });
  } catch (e) {
    fail("/hr/assets?new=1", e);
  }
  refresh();
  go(`/hr/assets/${id}`, "msg", "Item recorded. Issue it to someone below, or leave it in stock.");
}

export async function updateItemAction(formData: FormData): Promise<void> {
  const user = await requirePermission("assets.custody");
  const id = str(formData, "id");
  const to = `/hr/assets/${id}`;
  try {
    const a = await updateItem(db, {
      organizationId: user.organizationId, assetId: id, name: formData.has("name") ? str(formData, "name") : undefined, category: str(formData, "category") || undefined,
      serialNumber: str(formData, "serialNumber"), condition: str(formData, "condition"), location: str(formData, "location"), notes: str(formData, "notes"),
    });
    await audit(user, { action: "asset.update", entity: "Asset", entityId: a.id, after: { condition: a.condition, location: a.location } });
  } catch (e) {
    fail(`${to}?edit=1`, e);
  }
  refresh(id);
  go(to, "msg", "Details saved.");
}

// Issue from the item's page, the employee's HR page or an equipment request. The employee is asked to confirm receipt.
export async function issueItemAction(formData: FormData): Promise<void> {
  const user = await requirePermission("assets.custody");
  const assetId = str(formData, "assetId");
  const to = safe(str(formData, "returnTo"), `/hr/assets/${assetId}`);
  const requestId = str(formData, "requestId") || undefined;
  try {
    const { asset, assignment } = await issueItem(db, { organizationId: user.organizationId, assetId, userId: str(formData, "userId"), actorId: user.id, condition: str(formData, "condition") || undefined, requestId });
    await audit(user, { action: "asset.issue", entity: "Asset", entityId: asset.id, after: { to: assignment.userId, condition: assignment.conditionOut, requestId: requestId ?? null } });
    if (requestId) await audit(user, { action: "request.approve", entity: "EmployeeRequest", entityId: requestId, after: { issued: asset.number } });
    await notify(db, assignment.userId, {
      kind: "asset.issued", title: `${asset.name} (${asset.number}) has been issued to you`,
      body: "Open My profile and confirm you received it. Tell HR straight away if anything is wrong with it.", link: "/me/profile#assets", dedupeKey: `asset-issued:${assignment.id}`,
    });
  } catch (e) {
    fail(to, e);
  }
  refresh(assetId);
  revalidatePath("/hr/requests");
  revalidatePath("/me/requests");
  go(to, "msg", requestId ? "Item issued and the request approved. The employee has been asked to confirm receipt." : "Item issued. The employee has been asked to confirm receipt.");
}

export async function returnItemAction(formData: FormData): Promise<void> {
  const user = await requirePermission("assets.custody");
  const assetId = str(formData, "assetId");
  const to = safe(str(formData, "returnTo"), `/hr/assets/${assetId}`);
  const condition = str(formData, "condition");
  try {
    const { asset, fromUserId } = await returnItem(db, { organizationId: user.organizationId, assetId, actorId: user.id, condition, note: str(formData, "note") || str(formData, "reason") });
    await audit(user, { action: "asset.return", entity: "Asset", entityId: asset.id, after: { from: fromUserId, condition } });
    if (fromUserId && fromUserId !== user.id) {
      await notify(db, fromUserId, {
        kind: "asset.returned", title: condition === "LOST" ? `HR recorded ${asset.name} (${asset.number}) as not returned` : `HR took back ${asset.name} (${asset.number})`,
        body: condition === "LOST" ? undefined : `Condition recorded: ${CONDITION_LABEL[condition] ?? condition}.`, link: "/me/profile#assets",
      });
    }
  } catch (e) {
    fail(to, e);
  }
  refresh(assetId);
  go(to, "msg", condition === "LOST" ? "Recorded as not returned. Write the item off if it is gone for good." : "Taken back into stock.");
}

export async function writeOffItemAction(formData: FormData): Promise<void> {
  const user = await requirePermission("assets.custody");
  const assetId = str(formData, "assetId");
  const to = `/hr/assets/${assetId}`;
  const reason = str(formData, "writeOffReason");
  try {
    const a = await writeOffItem(db, { organizationId: user.organizationId, assetId, actorId: user.id, reason, note: str(formData, "note") || str(formData, "reason") });
    await audit(user, { action: "asset.write_off", entity: "Asset", entityId: a.id, after: { reason: a.writeOffReason } });
  } catch (e) {
    fail(to, e);
  }
  refresh(assetId);
  go(to, "msg", `Written off (${(WRITE_OFF_LABEL[reason] ?? reason).toLowerCase()}). The record and its history are kept.`);
}

// The employee confirms receipt on My profile. Their own handover only; checked in the service.
export async function acknowledgeItemAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    const h = await acknowledgeItem(db, { organizationId: user.organizationId, assignmentId: str(formData, "assignmentId"), userId: user.id });
    await audit(user, { action: "asset.acknowledge", entity: "AssetAssignment", entityId: h.id });
  } catch (e) {
    fail("/me/profile", e);
  }
  refresh(str(formData, "assetId") || undefined);
  go("/me/profile", "msg", "Thanks. HR can see you confirmed receipt.");
}
