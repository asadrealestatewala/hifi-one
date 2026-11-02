// Push notifications to the mobile app through Expo's push service. Free of Next.js imports.
// Best effort: a failed push never breaks the action that caused the notification (the in-app notification is still saved).
// Android builds need Firebase (FCM) credentials uploaded to EAS; without them Expo refuses the send and we simply log nothing.
import type { PrismaClient } from "@prisma/client";

const ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const isExpoPushToken = (t: string) => /^Expo(nent)?PushToken\[[^\]\s]{6,}\]$/.test(t);

export async function pushToUser(db: PrismaClient, userId: string, n: { title: string; body?: string | null }) {
  if (process.env.NODE_ENV === "test" || process.env.PUSH_DISABLED === "1") return;
  const devices = await db.pushDevice.findMany({ where: { userId }, select: { token: true } });
  if (devices.length === 0) return;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(devices.map((d) => ({ to: d.token, title: n.title.slice(0, 120), body: n.body?.slice(0, 240) ?? undefined, sound: "default", channelId: "default", data: { screen: "inbox" } }))),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return;
  const out = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
  // Phones that uninstalled the app are forgotten so we stop sending to them
  const dead = (out?.data ?? []).flatMap((r, i) => (r.status === "error" && r.details?.error === "DeviceNotRegistered" ? [devices[i].token] : []));
  if (dead.length) await db.pushDevice.deleteMany({ where: { token: { in: dead } } });
}
