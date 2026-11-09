"use server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { acknowledgeCircular, openCirculars, type CircularCard } from "@/lib/circulars";

export type AckResult = { ok: boolean };

// Used by the popup that appears for any signed-in employee. Both only ever touch the caller's own circulars.
export async function loadOpenCirculars(): Promise<CircularCard[]> {
  const user = await requireUser();
  return openCirculars(db, user.id);
}

export async function acknowledgeCircularAction(id: string): Promise<AckResult> {
  const user = await requireUser();
  return { ok: await acknowledgeCircular(db, user.id, String(id)) };
}
