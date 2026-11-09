// Publishing and phone alerts for calls, shared by the call routes and the meeting room's leave hooks.
import type { PrismaClient } from "@prisma/client";
import type { ChatMessageDto } from "./chat";
import { publishTo, isOnline } from "./chat-hub";
import { pushToUser } from "./push";

export function publishCallUpdate(out: { message: ChatMessageDto; recipients: string[] } | null) {
  if (out) publishTo(out.recipients, "call-update", { message: out.message });
}

export function ringCallee(db: PrismaClient, p: { calleeId: string; callerName: string; message: ChatMessageDto; mode: string }) {
  publishTo([p.calleeId], "call", { message: p.message, callerName: p.callerName, mode: p.mode });
  // Someone with no open Hifi One page gets a phone alert instead
  if (!isOnline(p.calleeId)) void pushToUser(db, p.calleeId, { title: `${p.callerName} is calling`, body: `Incoming ${p.mode === "video" ? "video" : "voice"} call` }).catch(() => {});
}
