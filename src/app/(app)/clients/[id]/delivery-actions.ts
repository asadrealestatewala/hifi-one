"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeliveryError, recordReview, setRecordingUrl } from "@/lib/delivery";

const back = (clientId: string, q: string) => redirect(`/clients/${clientId}?tab=delivery&${q}`);

export async function saveReview(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  let note = "saved=1";
  try {
    const r = await recordReview(db, { organizationId: user.organizationId, clientId, weekOf: String(formData.get("weekOf") ?? ""), rating: Number(formData.get("rating") || 0), review: String(formData.get("review") ?? ""), meetingId: String(formData.get("meetingId") ?? "") || null, reviewerId: user.id });
    await audit(user, { action: "client.review", entity: "ClientReview", entityId: r.review.id, after: { clientId, rating: r.review.rating, week: r.review.weekStart, pool: r.pool, shared: r.shared } });
    note = `saved=1&shared=${r.shared}&pool=${r.pool}`;
  } catch (e) {
    if (e instanceof DeliveryError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, note);
}

export async function attachRecording(formData: FormData): Promise<void> {
  const user = await requirePermission("meetings.use");
  const clientId = String(formData.get("clientId") ?? "");
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await setRecordingUrl(db, { organizationId: user.organizationId, meetingId, url: String(formData.get("url") ?? "") });
    await audit(user, { action: "meeting.recording_link", entity: "Meeting", entityId: meetingId });
  } catch (e) {
    if (e instanceof DeliveryError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}
