// Multi-factor authentication with an authenticator app. Free of Next.js imports so it can be tested against the database.
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUri, verifyTotp } from "./totp";

export class MfaError extends Error {}

type Db = PrismaClient;
type U = { id: string; totpSecretEnc: string | null; totpLastStep: number | null };

// Verifies a 6-digit code or a recovery code. A code can be used only once: TOTP steps only move forward,
// and a recovery code is removed the moment it works.
export async function checkSecondFactor(db: Db, user: U, input: string, appSecret: string): Promise<{ ok: true; usedRecoveryCode: boolean } | { ok: false }> {
  const code = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    if (!user.totpSecretEnc) return { ok: false };
    let secret: string;
    try {
      secret = decryptSecret(user.totpSecretEnc, appSecret);
    } catch {
      return { ok: false };
    }
    const step = verifyTotp(secret, code);
    if (step === null) return { ok: false };
    // Only accept if no code from this step or a later one was used (blocks replay, even with two simultaneous requests)
    const res = await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return res.count === 1 ? { ok: true, usedRecoveryCode: false } : { ok: false };
  }
  if (!/^[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}$/.test(code)) return { ok: false };
  const hash = hashRecoveryCode(code);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const fresh = await tx.user.findUnique({ where: { id: user.id }, select: { recoveryCodes: true } });
    const codes = ((fresh?.recoveryCodes as string[] | null) ?? []).slice();
    const i = codes.indexOf(hash);
    if (i < 0) return { ok: false as const };
    codes.splice(i, 1);
    await tx.user.update({ where: { id: user.id }, data: { recoveryCodes: codes } });
    return { ok: true as const, usedRecoveryCode: true };
  });
}

// Step 1 of enrolment: make a secret and store it (encrypted) but leave MFA off until a code from the app proves it works.
export async function beginMfaSetup(db: Db, userId: string, appSecret: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw new MfaError("Two-step verification is already on.");
  const secret = generateSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptSecret(secret, appSecret), totpLastStep: null } });
  return { secret, uri: otpauthUri(secret, user.email ?? user.phone ?? user.name) };
}

// Step 2: the first valid code turns it on and returns the recovery codes, which are shown once.
export async function confirmMfaSetup(db: Db, userId: string, code: string, appSecret: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw new MfaError("Two-step verification is already on.");
  if (!user.totpSecretEnc) throw new MfaError("Start the setup again.");
  const step = verifyTotp(decryptSecret(user.totpSecretEnc, appSecret), code);
  if (step === null) throw new MfaError("That code is not correct. Check the time on your phone and try the next code.");
  const codes = generateRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { totpEnabled: true, totpLastStep: step, recoveryCodes: codes.map(hashRecoveryCode) } });
  return codes;
}

// Turning it off yourself needs your password, so a stolen open session cannot weaken the account.
export async function disableMfa(db: Db, userId: string, password: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new MfaError("Your password is not correct.");
  await db.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null, recoveryCodes: [] } });
}

export async function regenerateRecoveryCodes(db: Db, userId: string, password: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpEnabled) throw new MfaError("Two-step verification is not on.");
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new MfaError("Your password is not correct.");
  const codes = generateRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: codes.map(hashRecoveryCode) } });
  return codes;
}
