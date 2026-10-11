"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MeetingError, cancelMeeting, createMeeting, guestLink, joinAsStaff } from "@/lib/meetings";
import { baseUrl, setTicket } from "@/lib/meeting-cookie";
import { MailError, sendEmail } from "@/lib/mailer";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (to: string, kind: "error" | "msg", m: string) => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);

export async function createMeetingAction(formData: FormData) {
  const user = await requirePermission("meetings.use");
  const returnTo = s(formData, "returnTo").startsWith("/") && !s(formData, "returnTo").startsWith("//") ? s(formData, "returnTo") : "/meetings";
  let id: string;
  try {
    const projectId = s(formData, "projectId") || null;
    const project = projectId ? await db.project.findFirst({ where: { id: projectId, organizationId: user.organizationId }, select: { clientId: true } }) : null;
    const m = await createMeeting(db, {
      organizationId: user.organizationId, hostId: user.id, title: s(formData, "title"), kind: s(formData, "kind") || "MEETING", projectId, clientId: s(formData, "clientId") || project?.clientId || null,
      agenda: s(formData, "agenda"), scheduledAt: s(formData, "scheduledAt") || null, durationMin: Number(s(formData, "durationMin") || 60), waitingRoom: formData.get("waitingRoom") === "on",
    });
    id = m.id;
    await audit(user, { action: "meeting.create", entity: "Meeting", entityId: m.id, after: { title: m.title, kind: m.kind } });
  } catch (e) {
    if (e instanceof MeetingError) return back(returnTo, "error", e.message);
    throw e;
  }
  redirect(`/meetings/${id}`);
}

export async function cancelAction(formData: FormData) {
  const user = await requirePermission("meetings.use");
  const id = s(formData, "id");
  try {
    await cancelMeeting(db, { organizationId: user.organizationId, meetingId: id, userId: user.id });
    await audit(user, { action: "meeting.cancel", entity: "Meeting", entityId: id });
  } catch (e) {
    if (e instanceof MeetingError) return back(`/meetings/${id}`, "error", e.message);
    throw e;
  }
  redirect("/meetings");
}

export async function enterRoomAction(formData: FormData) {
  const user = await requirePermission("meetings.use");
  const id = s(formData, "id");
  try {
    const { participant } = await joinAsStaff(db, { meetingId: id, user: { id: user.id, name: user.name, organizationId: user.organizationId } });
    await setTicket(id, participant.ticket);
  } catch (e) {
    if (e instanceof MeetingError) return back(`/meetings/${id}`, "error", e.message);
    throw e;
  }
  redirect(`/room/${id}`);
}

export async function emailInviteAction(formData: FormData) {
  const user = await requirePermission("meetings.use");
  const id = s(formData, "id");
  const m = await db.meeting.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!m) redirect("/meetings");
  const link = guestLink(await baseUrl(), m.joinToken);
  const when = m.scheduledAt ? `on ${m.scheduledAt.toUTCString()}` : "now";
  try {
    const r = await sendEmail(db, {
      organizationId: user.organizationId, to: s(formData, "to"), subject: `${m.kind === "WORKSHOP" ? "Workshop" : "Meeting"} invitation: ${m.title}`, relatedType: "MEETING", relatedId: m.id, actorId: user.id,
      text: `${user.name} has invited you to ${m.title} ${when}.\n\nJoin from your browser, no account needed:\n${link}\n\nYou will wait briefly until the host lets you in. Use a recent version of Chrome, Edge, Firefox or Safari and allow your camera and microphone if you want to be seen and heard.${m.agenda ? `\n\nAgenda:\n${m.agenda}` : ""}`,
    });
    await audit(user, { action: "meeting.email_invite", entity: "Meeting", entityId: m.id, after: { status: r.status } });
    if (r.status === "SENT") return back(`/meetings/${id}`, "msg", `Invitation emailed to ${r.toEmail}.`);
    return back(`/meetings/${id}`, "error", r.status === "NOT_CONFIGURED" ? "Email is not connected, so nothing was sent. Copy the link instead, or set up email under Settings > Email." : `The mail server did not accept it: ${r.error}`);
  } catch (e) {
    if (e instanceof MailError) return back(`/meetings/${id}`, "error", e.message);
    throw e;
  }
}
