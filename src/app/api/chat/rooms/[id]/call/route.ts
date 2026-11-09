import { requirePermission } from "@/lib/auth";
import { chatFail, noStore, staffOnly, toChatActor } from "@/lib/chat-http";
import { expireCall, RING_SECONDS, startCall } from "@/lib/chat-calls";
import { publishCallUpdate, ringCallees } from "@/lib/chat-call-http";
import { publishTo } from "@/lib/chat-hub";
import { db } from "@/lib/db";
import { setTicket } from "@/lib/meeting-cookie";
import { RateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const limiter = new RateLimiter(10, 60_000); // ten call attempts a minute per person

// Start a voice or video call in a conversation (everyone else in it is rung). Body: { mode: "audio" | "video" }.
// Returns where to go: the caller enters the call room at once while the others' phones and screens ring.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  if (!user.permissions.has("meetings.use")) return Response.json({ error: "You do not have permission to make calls." }, { status: 403 });
  if (!limiter.take(user.id)) return Response.json({ error: "Too many call attempts. Wait a moment." }, { status: 429 });
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { mode?: string } | null;
  try {
    const r = await startCall(db, toChatActor(user), id, String(b?.mode ?? ""));
    await setTicket(r.meetingId, r.ticket);
    publishTo(r.recipients, "message", { message: r.message });
    ringCallees(db, { calleeIds: r.calleeIds, callerName: user.name, message: r.message, mode: r.call.mode, roomName: r.roomName, group: r.group });
    setTimeout(() => { void expireCall(db, r.message.id).then(publishCallUpdate).catch(() => {}); }, RING_SECONDS * 1000);
    return Response.json({ roomUrl: `/room/${r.meetingId}?call=${r.call.mode}`, message: r.message }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
