import QRCode from "qrcode";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSecret, otpauthUri } from "@/lib/totp";
import SecurityPanel from "./SecurityPanel";

export const dynamic = "force-dynamic";

export default async function Security() {
  const user = await requireUser();
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  let pending: { secret: string; qr: string } | null = null;
  if (!row.totpEnabled && row.totpSecretEnc) {
    // Setup was started but not confirmed: show the same secret again so the user can finish
    try {
      const secret = decryptSecret(row.totpSecretEnc, process.env.SESSION_SECRET ?? "");
      pending = { secret, qr: await QRCode.toDataURL(otpauthUri(secret, row.email), { width: 200, margin: 1 }) };
    } catch {
      pending = null;
    }
  }
  const remaining = ((row.recoveryCodes as string[] | null) ?? []).length;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Account security</h1>
      <SecurityPanel enabled={row.totpEnabled} pending={pending} remaining={remaining} />
    </div>
  );
}
