"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ResaleError, addSchool, enterCount, monthLabel } from "@/lib/partner-resale";

const BASE = "/partner/schools";
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (month: string, kind: "saved" | "error", msg: string): never => redirect(`${BASE}?${month ? `month=${encodeURIComponent(month)}&` : ""}${kind}=${encodeURIComponent(msg)}`);
const failed = (month: string, e: unknown): never => {
  if (e instanceof ResaleError) return back(month, "error", e.message);
  throw e;
};

// The partner adds a school they sell to. It becomes a Hifi client; a name Hifi already has is refused (staff link it).
export async function addSchoolAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  try {
    const s = await addSchool(db, { organizationId: user.organizationId, earnerId: earner.id, actorId: user.id, byStaff: false, input: { productCode: str(formData, "productCode"), name: str(formData, "name"), email: str(formData, "email"), phone: str(formData, "phone"), city: str(formData, "city"), startMonth: str(formData, "startMonth") } });
    await audit(user, { action: "partner.school.add", entity: "ResaleSchool", entityId: s.id, after: { earnerId: earner.id, clientId: s.clientId, startMonth: s.startMonth } });
  } catch (e) { failed("", e); }
  revalidatePath(BASE);
  back("", "saved", "School added.");
}

// The partner enters a month's count. It waits for Hifi to confirm before it is billed.
export async function enterCountAction(formData: FormData): Promise<void> {
  const { user, earner } = await requirePartnerUser();
  const month = str(formData, "month");
  try {
    const { before, after } = await enterCount(db, { organizationId: user.organizationId, earnerId: earner.id, schoolId: str(formData, "schoolId"), month, units: str(formData, "units"), actorId: user.id, byStaff: false });
    await audit(user, { action: "partner.count.enter", entity: "ResaleCount", entityId: after.id, before: before ? { units: before.units } : undefined, after: { units: after.units, month } });
  } catch (e) { failed(month, e); }
  revalidatePath(BASE);
  back(month, "saved", `Count saved for ${monthLabel(month)}. Hifi confirms it before billing.`);
}
