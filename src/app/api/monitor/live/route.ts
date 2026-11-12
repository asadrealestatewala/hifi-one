import { requirePermission } from "@/lib/auth";
import { subscribe } from "@/lib/chat-hub";
import { db } from "@/lib/db";
import { LiveViewError, endLiveView, liveKey, relayLiveSignal, requestLiveView, respondLiveView } from "@/lib/live-view";
import { iceServers } from "@/lib/meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The person's own event stream: requests to them, answers to their requests, handshake messages, "ended".
export async function GET(req: Request) {
  const user = await requirePermission("monitoring.own", { json: true });
  if (user instanceof Response) return user;
  if (user.userType !== "EMPLOYEE") return reply({ error: "Staff only." }, 403);
  const enc = new TextEncoder();
  let off: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      off = subscribe(liveKey(user.id), send);
      beat = setInterval(() => { try { controller.enqueue(enc.encode(": keepalive\n\n")); } catch { /* closed */ } }, 20_000);
      send("hello", { iceServers: iceServers() });
      req.signal.addEventListener("abort", () => { if (beat) clearInterval(beat); off?.(); try { controller.close(); } catch { /* already closed */ } });
    },
    cancel() { if (beat) clearInterval(beat); off?.(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}

// { op: "request", subjectId } | { op: "respond", id, accept } | { op: "end", id } | { op: "signal", id, data }
export async function POST(req: Request) {
  const user = await requirePermission("monitoring.own", { json: true });
  if (user instanceof Response) return user;
  if (user.userType !== "EMPLOYEE") return reply({ error: "Staff only." }, 403);
  let b: { op?: string; subjectId?: string; id?: string; accept?: boolean; data?: unknown };
  try { b = await req.json(); } catch { return reply({ error: "Bad request." }, 400); }
  try {
    if (b.op === "request") { const lv = await requestLiveView(db, { id: user.id, organizationId: user.organizationId, name: user.name, permissions: user.permissions }, String(b.subjectId ?? "")); return reply({ id: lv.id }); }
    if (b.op === "respond") { await respondLiveView(db, user.id, String(b.id ?? ""), b.accept === true); return reply({ ok: true }); }
    if (b.op === "end") { await endLiveView(db, user.id, String(b.id ?? "")); return reply({ ok: true }); }
    if (b.op === "signal") { await relayLiveSignal(db, user.id, String(b.id ?? ""), b.data); return reply({ ok: true }); }
    return reply({ error: "Unknown request." }, 400);
  } catch (e) {
    if (e instanceof LiveViewError) return reply({ error: e.message }, 409);
    throw e;
  }
}
