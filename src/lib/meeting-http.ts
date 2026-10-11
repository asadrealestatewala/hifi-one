// Shared plumbing for the live meeting endpoints: the participant's ticket cookie, JSON replies, and the roster everyone sees.
import { db } from "./db";
import { online, publish } from "./meeting-hub";

export const cookieName = (meetingId: string) => `mt_${meetingId}`;
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function ticketFrom(req: Request, meetingId: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const name = cookieName(meetingId);
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

type P = { id: string; name: string; isHost: boolean; userId: string | null };

// Everyone in the call sees who is present; only hosts also see who is waiting at the door.
export async function broadcastRoster(meetingId: string) {
  const m = await db.meeting.findUnique({ where: { id: meetingId }, include: { participants: { where: { status: { in: ["ADMITTED", "WAITING"] } } } } });
  if (!m) return;
  const here = new Set(online(meetingId));
  const hostLike = (p: P) => p.isHost || (p.userId !== null && p.userId === m.hostId);
  const admitted = m.participants.filter((p) => p.status === "ADMITTED");
  const waiting = m.participants.filter((p) => p.status === "WAITING" && here.has(p.id));
  const list = admitted.map((p) => ({ id: p.id, name: p.name, isHost: hostLike(p), online: here.has(p.id) }));
  const hosts = admitted.filter(hostLike).map((p) => p.id);
  const others = admitted.filter((p) => !hostLike(p)).map((p) => p.id);
  publish(meetingId, "roster", { people: list, waiting: waiting.map((p) => ({ id: p.id, name: p.name })) }, { only: hosts });
  publish(meetingId, "roster", { people: list, waiting: [] }, { only: others });
}

export async function peersFor(meetingId: string, selfId: string) {
  const here = new Set(online(meetingId));
  const ps = await db.meetingParticipant.findMany({ where: { meetingId, status: "ADMITTED", id: { not: selfId } } });
  return ps.filter((p) => here.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
}
