// Phone alerts for chat messages: only for people with no open chat stream and who have not muted the room. Best effort.
import type { PrismaClient } from "@prisma/client";
import type { ChatMessageDto } from "./chat";
import { isOnline } from "./chat-hub";
import { pushToUser } from "./push";

export async function notifyOffline(db: PrismaClient, m: ChatMessageDto, recipients: string[], senderName: string, roomName: string) {
  if (m.kind === "SYSTEM") return;
  const targets = recipients.filter((id) => id !== m.senderId && !isOnline(id));
  if (targets.length === 0) return;
  const muted = new Set((await db.chatMember.findMany({ where: { roomId: m.roomId, userId: { in: targets }, muted: true }, select: { userId: true } })).map((x) => x.userId));
  const label = { IMAGE: "Sent a picture", VIDEO: "Sent a video", AUDIO: "Sent a voice message", FILE: "Sent a file" }[m.kind];
  const text = !m.body && label ? label : m.body;
  for (const id of targets) {
    if (muted.has(id)) continue;
    await pushToUser(db, id, { title: roomName === senderName ? senderName : `${senderName} in ${roomName}`, body: text }).catch(() => {});
  }
}
