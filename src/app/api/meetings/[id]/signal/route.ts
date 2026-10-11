import { db } from "@/lib/db";
import { isOnline, publish } from "@/lib/meeting-hub";
import { json, ticketFrom } from "@/lib/meeting-http";
import { authenticateParticipant } from "@/lib/meetings";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const KINDS = new Set(["offer", "answer", "candidate", "state"]);

// Passes a WebRTC handshake message (or a mute/share state) from one admitted person to another admitted person in the same meeting.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await authenticateParticipant(db, id, ticketFrom(req, id));
  if (!me || me.status !== "ADMITTED") return json({ error: "Not found" }, 404);
  if (!limiter("meeting-signal", 1200, 60_000).take(me.id)) return json({ error: "Too many messages" }, 429);
  const text = await req.text();
  if (text.length > 40_000) return json({ error: "Too large" }, 413);
  let b: { to?: string; kind?: string; payload?: unknown };
  try { b = JSON.parse(text); } catch { return json({ error: "Bad request" }, 400); }
  if (!b.to || !b.kind || !KINDS.has(b.kind)) return json({ error: "Bad request" }, 400);
  const target = await db.meetingParticipant.findFirst({ where: { id: b.to, meetingId: id, status: "ADMITTED" } });
  if (!target || !isOnline(id, target.id)) return json({ error: "That person is not connected" }, 409);
  publish(id, "signal", { from: me.id, kind: b.kind, payload: b.payload }, { to: target.id });
  return json({ ok: true });
}
