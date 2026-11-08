"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CircularError, sendCircular, type CircularAudience } from "@/lib/circulars";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function sendCircularAction(formData: FormData): Promise<void> {
  const user = await requirePermission("circulars.send");
  const type = s(formData, "audience");
  const audience: CircularAudience = type === "ROLES" ? { type: "ROLES", roleKeys: formData.getAll("roleKeys").map(String) } : type === "PEOPLE" ? { type: "PEOPLE", userIds: formData.getAll("userIds").map(String) } : { type: "ALL" };
  let id: string, n: number;
  try {
    const r = await sendCircular(db, { organizationId: user.organizationId, sentById: user.id, kind: s(formData, "kind"), title: s(formData, "title"), body: s(formData, "body"), audience });
    id = r.id; n = r.recipients;
    await audit(user, { action: "circular.send", entity: "Circular", entityId: id, after: { audience: audience.type, recipients: n, title: s(formData, "title").slice(0, 120) } });
  } catch (e) {
    if (e instanceof CircularError) redirect(`/hr/circulars?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/hr/circulars");
  redirect(`/hr/circulars/${id}?ok=${encodeURIComponent(`Sent to ${n} ${n === 1 ? "person" : "people"}. They get a notification and a popup until they confirm.`)}`);
}
