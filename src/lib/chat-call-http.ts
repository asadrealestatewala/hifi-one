// Publishing and phone alerts for calls, shared by the call routes and the meeting room's leave hooks.
import type { PrismaClient } from "@prisma/client";
import type { ChatMessageDto } from "./chat";
import { publishTo, isOnline } from "./chat-hub";
import { pushToUser } from "./push";

export function publishCallUpdate(out: { message: ChatMessageDto; recipients: string[] } | null) {
  if (out) publishTo(out.recipients, "call-update", { message: out.message });
}

export function ringCallees(db: PrismaClient, p: { calleeIds: string[]; callerName: string; message: ChatMessageDto; mode: string; roomName?: string | null; group: boolean }) {
  publishTo(p.calleeIds, "call", { message: p.message, callerName: p.callerName, mode: p.mode, group: p.group, roomName: p.roomName ?? null });
  const what = `${p.mode === "video" ? "video" : "voice"} call`;
  for (const id of p.calleeIds) {
    // Someone with no open Hifi One page gets a phone alert instead
    if (!isOnline(id)) void pushToUser(db, id, { title: p.group ? `${p.callerName} started a group call` : `${p.callerName} is calling`, body: p.group ? `${p.roomName ?? "Group"} · ${what}` : `Incoming ${what}` }).catch(() => {});
  }
}
