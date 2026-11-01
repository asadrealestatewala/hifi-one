// Onboarding of new staff accounts: an emailed one-time code proves the address is theirs, then an approver accepts the
// account before it can be used. Free of Next.js imports so it can be tested against the database.
//
// Rules enforced here:
// - A new staff account cannot sign in until its request is APPROVED. Accounts created before this existed have no request
//   and are not affected.
// - The code is 6 digits, valid for CODE_HOURS, compared in constant time, and dies after MAX_ATTEMPTS wrong tries. Only
//   hashes of the code and of the link are stored; the outbox keeps the email without them.
// - With no email address (or no mail connection) the request goes straight to approval and says the email is not verified.
// - Approvers hold onboarding.approve. Nobody approves their own account, and the person who added someone needs a second
//   approver unless they are a Super Admin (a one-admin company must still be able to onboard people).
// - Rejecting switches the account off and signs it out; history stays.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { canSend } from "./mailer";
import { appUrl, firstName, sendTemplate, sendTemplateQuietly } from "./email-template-store";
import { notify, notifyMany, usersWithPermission } from "./notifications";

type Db = PrismaClient;
export class OnboardingError extends Error {}

export const CODE_HOURS = 24;
export const LINK_DAYS = 7;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES = 8;
export const RESEND_GAP_MS = 60_000;
export const ONBOARDING_STATUSES = ["PENDING_VERIFICATION", "PENDING_APPROVAL", "APPROVED", "REJECTED"] as const;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const codeHash = (requestId: string, code: string) => sha(`${requestId}:${code}`);
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function rolesOf(db: Db, userId: string) {
  const rs = await db.userRole.findMany({ where: { userId }, include: { role: { select: { name: true } } } });
  return rs.map((r) => r.role.name).join(", ");
}

// Creates a fresh code and link on the request and emails them. Returns the delivery status.
async function sendCode(db: Db, p: { requestId: string; now: Date; requestedByName: string }) {
  const req = await db.onboardingRequest.findUniqueOrThrow({ where: { id: p.requestId } });
  const user = await db.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!user.email) throw new OnboardingError("This person has no email address to send a code to.");
  const code = newCode();
  const token = newToken();
  await db.onboardingRequest.update({
    where: { id: req.id },
    data: {
      codeHash: codeHash(req.id, code), codeExpiresAt: new Date(p.now.getTime() + CODE_HOURS * 3600_000), codeAttempts: 0,
      tokenHash: sha(token), tokenExpiresAt: new Date(p.now.getTime() + LINK_DAYS * 86_400_000), codesSent: { increment: 1 }, lastCodeAt: p.now,
    },
  });
  const m = await sendTemplate(db, {
    organizationId: req.organizationId, key: "onboarding_code", to: user.email, purpose: "ONBOARDING", relatedType: "User", relatedId: user.id, secret: true,
    vars: { first_name: firstName(user.name), name: user.name, code, link: `${appUrl()}/onboarding/${token}`, code_hours: String(CODE_HOURS), requested_by: p.requestedByName },
    buttonUrl: `${appUrl()}/onboarding/${token}`,
  });
  return m.status;
}

async function nameOf(db: Db, id: string | null | undefined) {
  if (!id) return "The team";
  return (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "The team";
}

// Called right after a staff account is created (HR Staff Directory or Administration > Users).
export async function startOnboarding(db: Db, p: { organizationId: string; userId: string; requestedById: string; now?: Date }) {
  const now = p.now ?? new Date();
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE" } });
  if (!user) throw new OnboardingError("Staff account not found.");
  if (await db.onboardingRequest.findUnique({ where: { userId: user.id } })) throw new OnboardingError("Onboarding has already started for this person.");
  const viaEmail = Boolean(user.email) && canSend();
  const req = await db.onboardingRequest.create({
    data: { organizationId: p.organizationId, userId: user.id, requestedById: p.requestedById, status: viaEmail ? "PENDING_VERIFICATION" : "PENDING_APPROVAL" },
  });
  if (!viaEmail) {
    await askApprovers(db, req.id);
    return { request: req, codeEmail: null as string | null };
  }
  const status = await sendCode(db, { requestId: req.id, now, requestedByName: await nameOf(db, p.requestedById) });
  return { request: req, codeEmail: status };
}

// One line for the screen that created the account.
export function onboardingNotice(r: { request: { status: string }; codeEmail: string | null }) {
  if (r.request.status === "PENDING_APPROVAL") return "No code could be emailed (no email address, or email is not connected), so the account went straight to the approvers. It can sign in once approved.";
  if (r.codeEmail === "SENT") return "A verification code was emailed. Once they enter it, an approver is asked to approve the account before it can sign in.";
  return "The verification email could not be sent. Send a new code from People & HR › Onboarding approvals, or approve once they are verified.";
}

// Sends a new code (the old one and the old link stop working). From the onboarding page or by HR.
export async function resendCode(db: Db, p: { organizationId?: string; requestId?: string; token?: string; now?: Date }) {
  const now = p.now ?? new Date();
  const req = p.token
    ? await db.onboardingRequest.findUnique({ where: { tokenHash: sha(p.token) } })
    : await db.onboardingRequest.findFirst({ where: { id: p.requestId ?? "", organizationId: p.organizationId ?? "" } });
  if (!req || (p.token && (!req.tokenExpiresAt || req.tokenExpiresAt < now))) throw new OnboardingError("This link is no longer valid. Ask HR to send a new code.");
  if (req.status !== "PENDING_VERIFICATION") throw new OnboardingError("This account does not need a code any more.");
  if (req.lastCodeAt && now.getTime() - req.lastCodeAt.getTime() < RESEND_GAP_MS) throw new OnboardingError("A code was sent less than a minute ago. Check your inbox and spam folder, then try again.");
  if (req.codesSent >= MAX_CODES) throw new OnboardingError("Too many codes were sent. Ask HR to check the email address.");
  if (!canSend()) throw new OnboardingError("Email is not connected, so no code can be sent. An approver can still approve the account.");
  return sendCode(db, { requestId: req.id, now, requestedByName: await nameOf(db, req.requestedById) });
}

// What the onboarding page needs to show, or null when the link is wrong, expired or already used.
export async function onboardingByToken(db: Db, token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const req = await db.onboardingRequest.findUnique({ where: { tokenHash: sha(token) } });
  if (!req || req.status !== "PENDING_VERIFICATION" || !req.tokenExpiresAt || req.tokenExpiresAt < now) return null;
  const user = await db.user.findUnique({ where: { id: req.userId }, select: { name: true, email: true, mustChangePassword: true, active: true } });
  if (!user?.active) return null;
  return { requestId: req.id, name: user.name, email: user.email, needsPassword: user.mustChangePassword, codeUsable: Boolean(req.codeHash && req.codeExpiresAt && req.codeExpiresAt > now) };
}

// The person enters the code (and chooses a password if they have none yet). On success the account waits for approval.
export async function verifyCode(db: Db, p: { token: string; code: string; password?: string; confirm?: string; now?: Date }) {
  const now = p.now ?? new Date();
  const code = p.code.replace(/\D/g, "");
  const result = await db.$transaction(async (tx) => {
    const found = await tx.onboardingRequest.findUnique({ where: { tokenHash: sha(p.token) } });
    if (!found) throw new OnboardingError("This link is no longer valid. Ask HR to send a new code.");
    await tx.$queryRaw`SELECT id FROM "OnboardingRequest" WHERE id = ${found.id} FOR UPDATE`;
    const req = await tx.onboardingRequest.findUniqueOrThrow({ where: { id: found.id } });
    if (req.status !== "PENDING_VERIFICATION" || !req.tokenExpiresAt || req.tokenExpiresAt < now) throw new OnboardingError("This link is no longer valid. Ask HR to send a new code.");
    if (!req.codeHash || !req.codeExpiresAt || req.codeExpiresAt < now) throw new OnboardingError("This code has expired. Send yourself a new one below.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!same(codeHash(req.id, code), req.codeHash)) {
      const attempts = req.codeAttempts + 1;
      await tx.onboardingRequest.update({ where: { id: req.id }, data: attempts >= MAX_ATTEMPTS ? { codeAttempts: attempts, codeHash: null } : { codeAttempts: attempts } });
      return { ok: false as const, error: attempts >= MAX_ATTEMPTS ? "Too many wrong codes. Send yourself a new one below." : `That code is not right. ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left.` };
    }
    let passwordHash: string | undefined;
    if (user.mustChangePassword || p.password) {
      if ((p.password ?? "").length < 10) throw new OnboardingError("Choose a password of at least 10 characters.");
      if (p.password !== p.confirm) throw new OnboardingError("The two passwords do not match.");
      passwordHash = await bcrypt.hash(p.password!, 12);
    }
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now, ...(passwordHash ? { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } : {}) } });
    // The link and code are single use; any setup link handed out earlier dies too, since the password is now set
    await tx.onboardingRequest.update({ where: { id: req.id }, data: { status: "PENDING_APPROVAL", verifiedAt: now, codeHash: null, tokenHash: null } });
    if (passwordHash) await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    return { ok: true as const, requestId: req.id };
  });
  if (!result.ok) throw new OnboardingError(result.error);
  await askApprovers(db, result.requestId);
  return result;
}

// In-app notice and email to everyone who can approve (never the new person themselves).
export async function askApprovers(db: Db, requestId: string) {
  const req = await db.onboardingRequest.findUniqueOrThrow({ where: { id: requestId } });
  const user = await db.user.findUniqueOrThrow({ where: { id: req.userId }, include: { department: { select: { name: true } }, employeeProfile: { select: { designation: true } } } });
  const approvers = (await usersWithPermission(db, req.organizationId, "onboarding.approve")).filter((id) => id !== user.id);
  const link = `${appUrl()}/hr/onboarding`;
  await notifyMany(db, approvers, { kind: "onboarding.approval", title: `Approve ${user.name}'s account`, body: req.verifiedAt ? "Email verified with a code" : "No verified email", link: "/hr/onboarding", dedupeKey: `onboarding-approval:${req.id}` });
  const people = await db.user.findMany({ where: { id: { in: approvers }, email: { not: null } }, select: { id: true, name: true, email: true } });
  const vars = {
    name: user.name, email: user.email ?? "No email on file", roles: await rolesOf(db, user.id), department: user.department?.name ?? "", designation: user.employeeProfile?.designation ?? "",
    requested_by: await nameOf(db, req.requestedById), verified: req.verifiedAt ? "Email verified with a one-time code" : "Not verified (no email, or email not connected)", link,
  };
  for (const a of people) {
    await sendTemplateQuietly(db, { organizationId: req.organizationId, key: "onboarding_approval_request", to: a.email!, purpose: "HR", relatedType: "OnboardingRequest", relatedId: req.id, vars: { ...vars, approver_first_name: firstName(a.name) }, buttonUrl: link });
  }
  return approvers.length;
}

export type Approver = { id: string; isSuperAdmin: boolean; permissions: ReadonlySet<string> };

export async function decideOnboarding(db: Db, p: { organizationId: string; requestId: string; actor: Approver; approve: boolean; note?: string; now?: Date }) {
  const now = p.now ?? new Date();
  if (!p.actor.permissions.has("onboarding.approve") && !p.actor.isSuperAdmin) throw new OnboardingError("You cannot approve new accounts.");
  const note = (p.note ?? "").trim().slice(0, 500) || null;
  const decided = await db.$transaction(async (tx) => {
    const found = await tx.onboardingRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
    if (!found) throw new OnboardingError("Request not found.");
    await tx.$queryRaw`SELECT id FROM "OnboardingRequest" WHERE id = ${found.id} FOR UPDATE`;
    const req = await tx.onboardingRequest.findUniqueOrThrow({ where: { id: found.id } });
    if (req.userId === p.actor.id) throw new OnboardingError("You cannot decide on your own account.");
    if (p.approve) {
      if (req.status === "PENDING_VERIFICATION") throw new OnboardingError("The person has not verified their email yet. Wait for them, or send a new code.");
      if (req.status !== "PENDING_APPROVAL") throw new OnboardingError("This request was already decided.");
      if (req.requestedById === p.actor.id && !p.actor.isSuperAdmin) throw new OnboardingError("Someone else must approve an account you added.");
    } else {
      if (!["PENDING_VERIFICATION", "PENDING_APPROVAL"].includes(req.status)) throw new OnboardingError("This request was already decided.");
      if (!note) throw new OnboardingError("Give a reason for rejecting the account.");
    }
    const updated = await tx.onboardingRequest.update({ where: { id: req.id }, data: { status: p.approve ? "APPROVED" : "REJECTED", decidedById: p.actor.id, decidedAt: now, decisionNote: note, codeHash: null, tokenHash: null } });
    if (!p.approve) {
      await tx.user.update({ where: { id: req.userId }, data: { active: false } });
      await tx.session.updateMany({ where: { userId: req.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.employeeProfile.updateMany({ where: { userId: req.userId }, data: { status: "INACTIVE" } });
    }
    return updated;
  });
  const user = await db.user.findUniqueOrThrow({ where: { id: decided.userId } });
  const actorName = await nameOf(db, p.actor.id);
  if (decided.requestedById && decided.requestedById !== p.actor.id) {
    await notify(db, decided.requestedById, { kind: "onboarding.decided", title: `${user.name}'s account was ${p.approve ? "approved" : "rejected"}`, body: `By ${actorName}${note ? `: ${note}` : ""}`, link: "/hr/onboarding", dedupeKey: `onboarding-decided:${decided.id}` });
  }
  let emailed: string | null = null;
  if (user.email) {
    emailed = (await sendTemplateQuietly(db, p.approve
      ? { organizationId: p.organizationId, key: "onboarding_approved", to: user.email, purpose: "ONBOARDING", relatedType: "User", relatedId: user.id, vars: { first_name: firstName(user.name), approved_by: actorName, login: user.email }, buttonUrl: `${appUrl()}/login` }
      : { organizationId: p.organizationId, key: "onboarding_rejected", to: user.email, purpose: "ONBOARDING", relatedType: "User", relatedId: user.id, vars: { first_name: firstName(user.name), note: note ?? "" } }))?.status ?? null;
  }
  return { ...decided, emailed };
}

// Sign-in asks this after the password was right. A message means "not yet".
export async function signInBlock(db: Db, userId: string): Promise<string | null> {
  const req = await db.onboardingRequest.findUnique({ where: { userId }, select: { status: true } });
  if (!req || req.status === "APPROVED") return null;
  if (req.status === "PENDING_VERIFICATION") return "Verify your email first: enter the code we emailed you, using the button in that email.";
  if (req.status === "PENDING_APPROVAL") return "Your account is waiting for approval. You will get an email as soon as it is approved.";
  return "This account is not active.";
}
