"use server";

import { revalidatePath } from "next/cache";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MfaError, beginMfaSetup, confirmMfaSetup, disableMfa, regenerateRecoveryCodes } from "@/lib/mfa";

export type MfaState = { error?: string; codes?: string[]; done?: string };

const appSecret = () => process.env.SESSION_SECRET ?? "";

export async function startMfa(): Promise<MfaState> {
  const user = await requireUser();
  try {
    await beginMfaSetup(db, user.id, appSecret());
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message };
    throw e;
  }
  revalidatePath("/account/security");
  return {};
}

export async function confirmMfa(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requireUser();
  try {
    const codes = await confirmMfaSetup(db, user.id, String(formData.get("code") ?? ""), appSecret());
    await audit(user, { action: "auth.mfa_enabled", entity: "User", entityId: user.id });
    revalidatePath("/account/security");
    return { codes };
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message };
    throw e;
  }
}

export async function turnOffMfa(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requireUser();
  try {
    await disableMfa(db, user.id, String(formData.get("password") ?? ""));
    await audit(user, { action: "auth.mfa_disabled", entity: "User", entityId: user.id });
    revalidatePath("/account/security");
    return { done: "Two-step verification is off." };
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message };
    throw e;
  }
}

export async function newRecoveryCodes(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requireUser();
  try {
    const codes = await regenerateRecoveryCodes(db, user.id, String(formData.get("password") ?? ""));
    await audit(user, { action: "auth.recovery_codes_regenerated", entity: "User", entityId: user.id });
    return { codes };
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message };
    throw e;
  }
}
