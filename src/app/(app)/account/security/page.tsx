import QRCode from "qrcode";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSecret, otpauthUri } from "@/lib/totp";
import SecurityPanel from "./SecurityPanel";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Security({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireUser({ allowMfaSetup: true });
  const { required } = await searchParams;
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  let pending: { secret: string; qr: string } | null = null;
  if (!row.totpEnabled && row.totpSecretEnc) {
    // Setup was started but not confirmed: show the same secret again so the user can finish
    try {
      const secret = decryptSecret(row.totpSecretEnc, process.env.SESSION_SECRET ?? "");
      pending = { secret, qr: await QRCode.toDataURL(otpauthUri(secret, row.email ?? row.phone ?? row.name), { width: 200, margin: 1 }) };
    } catch {
      pending = null;
    }
  }
  const remaining = ((row.recoveryCodes as string[] | null) ?? []).length;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
      {(required || (user.mfaRequired && !user.totpEnabled)) && <Notice kind="error">Your role requires two-step verification. Turn it on below to continue; nothing else in the system opens until you do.</Notice>}
      <SecurityPanel enabled={row.totpEnabled} pending={pending} remaining={remaining} />
    </div>
  );
}
