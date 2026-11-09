import { requirePermission } from "@/lib/auth";
import { history, sendMessage } from "@/lib/chat";
import { broadcastMessage, chatFail, staffOnly, noStore, toChatActor, toFileActor } from "@/lib/chat-http";
import { db } from "@/lib/db";
import { RateLimiter } from "@/lib/rate-limit";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
const limiter = new RateLimiter(40, 60_000); // 40 messages a minute per person

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const { id } = await params;
  const before = new URL(req.url).searchParams.get("before");
  const beforeDate = before ? new Date(before) : undefined;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) return Response.json({ error: "Bad request." }, { status: 400 });
  try {
    return Response.json(await history(db, toChatActor(user), id, { before: beforeDate }), { headers: noStore });
  } catch (e) { return chatFail(e); }
}

// Plain text as JSON { body }, or multipart with fields `body` and `file` (picture, video, voice note or document).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const { id } = await params;
  if (!limiter.take(user.id)) return Response.json({ error: "You are sending messages too fast. Wait a moment." }, { status: 429, headers: { "retry-after": String(limiter.retryAfterSeconds(user.id)) } });
  try {
    let body = "";
    let attachment: { name: string; bytes: Buffer } | undefined;
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      body = String(form.get("body") ?? "");
      const f = form.get("file");
      if (f instanceof File && f.size > 0) attachment = { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) };
    } else {
      const j = (await req.json().catch(() => null)) as { body?: string } | null;
      body = String(j?.body ?? "");
    }
    const actor = toChatActor(user);
    const { message, recipients } = await sendMessage(db, defaultStorage(), actor, toFileActor(user), id, { body, attachment });
    const room = await db.chatRoom.findUnique({ where: { id }, select: { kind: true, name: true } });
    broadcastMessage(message, recipients, user.name, room?.kind === "DIRECT" ? user.name : room?.name ?? "Group");
    return Response.json({ message }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
