// Shared bits for the team chat API routes.
import { toFileActor, type SessionUser } from "./auth";
import { ChatError, type ChatActor } from "./chat";
import { publishTo } from "./chat-hub";
import { db } from "./db";
import { notifyOffline } from "./chat-notify";
import type { ChatMessageDto } from "./chat";

export const noStore = { "cache-control": "no-store" };

// Team chat is for staff. Routes call requirePermission("chat.use", { json: true }) themselves, then this.
export function staffOnly(user: SessionUser): Response | null {
  return user.userType === "EMPLOYEE" ? null : Response.json({ error: "Team chat is for staff." }, { status: 403 });
}

export const toChatActor = (u: SessionUser): ChatActor => ({ id: u.id, organizationId: u.organizationId, name: u.name });
export { toFileActor };

export function chatFail(e: unknown): Response {
  if (e instanceof ChatError) return Response.json({ error: e.message }, { status: 400, headers: noStore });
  console.error("chat error", e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500, headers: noStore });
}

export function broadcastMessage(m: ChatMessageDto, recipients: string[], senderName: string, roomName: string) {
  publishTo(recipients, "message", { message: m });
  void notifyOffline(db, m, recipients, senderName, roomName).catch(() => {});
}
