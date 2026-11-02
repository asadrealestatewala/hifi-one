import { revokeSessionToken } from "@/lib/auth";
import { isResponse, json, requireMobileUser } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  await revokeSessionToken(a.token);
  return json({ ok: true });
}
