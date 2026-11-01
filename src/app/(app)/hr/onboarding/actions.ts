"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { OnboardingError, decideOnboarding, resendCode } from "@/lib/onboarding";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const go = (kind: "ok" | "error", m: string): never => redirect(`/hr/onboarding?${kind}=${encodeURIComponent(m)}`);

export async function decideOnboardingAction(formData: FormData): Promise<void> {
  const user = await requirePermission("onboarding.approve");
  const id = s(formData, "id");
  const approve = s(formData, "decision") === "approve";
  let told = "";
  try {
    const r = await decideOnboarding(db, { organizationId: user.organizationId, requestId: id, actor: toActor(user), approve, note: s(formData, "reason") });
    await audit(user, { action: approve ? "onboarding.approve" : "onboarding.reject", entity: "User", entityId: r.userId, after: { requestId: id, emailed: r.emailed } });
    told = r.emailed === "SENT" ? " We emailed them." : r.emailed ? " The email to them was not sent (check Settings › Email), so let them know yourself." : " They have no email address, so let them know yourself.";
  } catch (e) {
    if (e instanceof OnboardingError) go("error", e.message);
    throw e;
  }
  revalidatePath("/hr/onboarding");
  go("ok", (approve ? "Approved. They can sign in now." : "Rejected. The account is switched off.") + told);
}

export async function resendCodeAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const id = s(formData, "id");
  let status: string;
  try {
    status = await resendCode(db, { organizationId: user.organizationId, requestId: id });
    const r = await db.onboardingRequest.findUniqueOrThrow({ where: { id } });
    await audit(user, { action: "onboarding.resend_code", entity: "User", entityId: r.userId, after: { status } });
  } catch (e) {
    if (e instanceof OnboardingError) go("error", e.message);
    throw e;
  }
  go(status === "SENT" ? "ok" : "error", status === "SENT" ? "A new code was emailed. The old one no longer works." : `The email was not sent (${status.toLowerCase().replace("_", " ")}). Check Settings › Email.`);
}
