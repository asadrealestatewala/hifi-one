import { requirePermission } from "@/lib/auth";
import { subscribe } from "@/lib/chat-hub";
import { staffOnly } from "@/lib/chat-http";
import { totalUnread } from "@/lib/chat";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One live stream per open tab. It carries new messages, read receipts and room changes for the signed-in person only.
export async function GET(req: Request) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const enc = new TextEncoder();
  let off: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      off = subscribe(user.id, send);
      beat = setInterval(() => { try { controller.enqueue(enc.encode(": keepalive\n\n")); } catch { /* closed */ } }, 20_000);
      send("hello", { unread: await totalUnread(db, user.id) });
      req.signal.addEventListener("abort", () => { if (beat) clearInterval(beat); off?.(); try { controller.close(); } catch { /* already closed */ } });
    },
    cancel() { if (beat) clearInterval(beat); off?.(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
