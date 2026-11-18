"use server";

import { notFound, redirect } from "next/navigation";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeContentClient } from "@/lib/content-scope";
import { checkAccount, connectAccounts, disconnectAccount, SocialError } from "@/lib/social-meta";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (q: string): never => redirect(`/content/accounts?${q}`);
// The account must belong to a client this person works for (or the company, for people who see every project)
const mustSeeAccount = async (user: SessionUser, id: string) => {
  const a = await db.socialAccount.findFirst({ where: { id, organizationId: user.organizationId }, select: { clientId: true } });
  if (a && !(await canSeeContentClient(db, user, a.clientId))) notFound();
};

export async function chooseAccountsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.publish");
  let n = 0;
  try {
    n = await connectAccounts(db, { organizationId: user.organizationId, userId: user.id, sessionId: s(formData, "s"), picks: formData.getAll("pick").map(String) });
    await audit(user, { action: "social.connect", entity: "SocialAccount", entityId: "bulk", after: { picks: formData.getAll("pick").map(String) } });
  } catch (e) {
    if (e instanceof SocialError) go(`error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  go(`ok=${encodeURIComponent(`${n} account${n === 1 ? "" : "s"} connected.`)}`);
}

export async function disconnectAccountAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.publish");
  await mustSeeAccount(user, s(formData, "id"));
  try {
    const a = await disconnectAccount(db, { organizationId: user.organizationId, accountId: s(formData, "id") });
    await audit(user, { action: "social.disconnect", entity: "SocialAccount", entityId: a.id, before: { name: a.name, platform: a.platform } });
  } catch (e) {
    if (e instanceof SocialError) go(`error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  go(`ok=${encodeURIComponent("Disconnected. Its token was deleted.")}`);
}

export async function checkAccountAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.publish");
  await mustSeeAccount(user, s(formData, "id"));
  let ok = false;
  try { ok = await checkAccount(db, { organizationId: user.organizationId, accountId: s(formData, "id") }); }
  catch (e) { if (e instanceof SocialError) go(`error=${encodeURIComponent(e.message)}`); throw e; }
  go(ok ? `ok=${encodeURIComponent("The connection works.")}` : `error=${encodeURIComponent("The connection does not work. See the reason next to the account.")}`);
}
