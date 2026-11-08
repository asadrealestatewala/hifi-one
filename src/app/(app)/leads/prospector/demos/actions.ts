"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { closeDemo, scheduleDemo } from "@/lib/demo-bookings";
import { companyZone } from "@/lib/mobile-api";
import { ProspectorError } from "@/lib/prospector";

const BASE = "/leads/prospector/demos";
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const safeBack = (f: FormData) => { const b = s(f, "back"); return b.startsWith(`${BASE}?`) || b === BASE ? b : BASE; }; // only our own list, never a link from the form
const flash = (kind: "error" | "ok", m: string, back: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);

// Book or move a demo (decision 73). The first booking turns the prospect into a lead for the agent who found it.
export async function scheduleDemoAction(formData: FormData): Promise<void> {
  const user = await requirePermission("prospector.schedule_demo");
  const back = safeBack(formData);
  const id = s(formData, "id");
  try {
    // the form's datetime-local is in the company's zone; the offset the browser sent turns it into an instant
    const local = s(formData, "scheduledAt");
    const offset = Number(s(formData, "tzOffset") || "NaN");
    const at = local && Number.isFinite(offset) ? new Date(new Date(`${local}:00Z`).getTime() + offset * 60_000) : local;
    const r = await scheduleDemo(db, user, id, { scheduledAt: at, trainerId: s(formData, "trainerId") || null, mode: s(formData, "mode"), note: s(formData, "note"), timeZone: await companyZone(user.organizationId) });
    await audit(user, { action: r.rescheduled ? "demo.reschedule" : "demo.schedule", entity: "DemoBooking", entityId: r.bookingId, after: { leadId: r.leadId, linkedExisting: r.linkedExisting, owner: r.owner } });
    return flash("ok", r.rescheduled ? "Demo moved. The agent and the trainer have been told." : r.linkedExisting ? "Demo booked and linked to the lead that already had this contact." : "Demo booked. The business is now a lead of the agent who found it.", back);
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message, back);
    throw e;
  }
}

// Done, no show, or cancelled with a reason
export async function closeDemoAction(formData: FormData): Promise<void> {
  const user = await requirePermission("prospector.schedule_demo");
  const back = safeBack(formData);
  try {
    const r = await closeDemo(db, user, s(formData, "id"), { status: s(formData, "status"), reason: s(formData, "reason"), timeZone: await companyZone(user.organizationId) });
    await audit(user, { action: "demo.close", entity: "DemoBooking", entityId: r.bookingId, after: { status: r.status, leadId: r.leadId } });
    return flash("ok", r.status === "DONE" ? "Marked as done." : r.status === "NO_SHOW" ? "Marked as a no show; the agent has been told." : r.leadId ? "Demo cancelled; the lead stays in the CRM." : "Request cancelled; the shop is back on the agent's go-back list.", back);
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message, back);
    throw e;
  }
}
