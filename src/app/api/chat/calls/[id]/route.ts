import { requirePermission } from "@/lib/auth";
import { chatFail, noStore, staffOnly, toChatActor } from "@/lib/chat-http";
import { answerCall, cancelCall, declineCall } from "@/lib/chat-calls";
import { publishCallUpdate } from "@/lib/chat-call-http";
import { db } from "@/lib/db";
import { setTicket } from "@/lib/meeting-cookie";

export const dynamic = "force-dynamic";

// Answer, decline or (as the caller) cancel a ringing call. Body: { action: "answer" | "decline" | "cancel" }. The id is the call message.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  if (!user.permissions.has("meetings.use")) return Response.json({ error: "You do not have permission to make calls." }, { status: 403 });
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { action?: string } | null;
  const actor = toChatActor(user);
  try {
    if (b?.action === "answer") {
      const r = await answerCall(db, actor, id);
      await setTicket(r.meetingId, r.ticket);
      publishCallUpdate(r);
      return Response.json({ roomUrl: `/room/${r.meetingId}?call=${r.mode}` }, { headers: noStore });
    }
    if (b?.action === "decline") { publishCallUpdate(await declineCall(db, actor, id)); return Response.json({ ok: true }, { headers: noStore }); }
    if (b?.action === "cancel") { publishCallUpdate(await cancelCall(db, actor, id)); return Response.json({ ok: true }, { headers: noStore }); }
    return Response.json({ error: "Bad request." }, { status: 400 });
  } catch (e) { return chatFail(e); }
}
