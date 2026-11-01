import { db } from "@/lib/db";
import { isOnline, publish, subscribe } from "@/lib/meeting-hub";
import { broadcastRoster, peersFor, ticketFrom } from "@/lib/meeting-http";
import { authenticateParticipant, history, iceServers, leave } from "@/lib/meetings";
import { isRecording } from "@/lib/recordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The live stream for one participant. The caller is identified by the ticket cookie set when they joined (authenticateParticipant);
// anything else gets an empty 404. Waiting guests get only their own status; admitted people get the roster, signals and chat.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await authenticateParticipant(db, id, ticketFrom(req, id));
  if (!me) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const enc = new TextEncoder();
  let off: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      off = subscribe(id, me.id, send);
      beat = setInterval(() => { try { controller.enqueue(enc.encode(": keepalive\n\n")); } catch { /* closed */ } }, 20_000);
      const you = { id: me.id, name: me.name, isHost: me.isHost || (me.userId !== null && me.userId === me.meeting.hostId), status: me.status };
      send("hello", { you, title: me.meeting.title, kind: me.meeting.kind, iceServers: iceServers(), recording: me.status === "ADMITTED" && (await isRecording(db, id)) });
      if (me.status === "ADMITTED") send("welcome", { peers: await peersFor(id, me.id), messages: await history(db, id) });
      await broadcastRoster(id);
      const close = () => {
        if (beat) clearInterval(beat);
        off?.();
        try { controller.close(); } catch { /* already closed */ }
        // A refresh reconnects within seconds; only a real departure marks the person as having left.
        setTimeout(async () => {
          if (!isOnline(id, me.id)) { await leave(db, me.id); publish(id, "peer-left", { id: me.id }); await broadcastRoster(id); }
        }, 20_000);
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() { if (beat) clearInterval(beat); off?.(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
