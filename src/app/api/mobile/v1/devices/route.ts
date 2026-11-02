import { db } from "@/lib/db";
import { isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";
import { isExpoPushToken } from "@/lib/push";

export const dynamic = "force-dynamic";

// Register this phone for push notifications (POST { token, platform }) or forget it (DELETE { token }). A phone belongs to the latest person who signed in on it.
export async function POST(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  const body = await readJson(req);
  const token = str(body.token, 200);
  if (!isExpoPushToken(token)) return json({ error: "Not a valid push token." }, 400);
  const platform = body.platform === "ios" ? "ios" : "android";
  await db.pushDevice.upsert({ where: { token }, update: { userId: a.user.id, platform, lastSeenAt: new Date() }, create: { userId: a.user.id, token, platform } });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  await db.pushDevice.deleteMany({ where: { token: str((await readJson(req)).token, 200), userId: a.user.id } });
  return json({ ok: true });
}
