import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_META } from "@/lib/content-rules";
import { callbackUrl, metaApp } from "@/lib/social-meta";
import { ConfirmButton, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { PlatformDot } from "../PostForm";
import { checkAccountAction, disconnectAccountAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Connected", cls: "border-success/30 text-success" },
  EXPIRED: { label: "Needs connecting again", cls: "border-brand/30 text-brand" },
};

export default async function SocialAccounts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("content.publish");
  const sp = await searchParams;
  const org = user.organizationId;
  const [app, clients, accounts] = await Promise.all([
    metaApp(db, org),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.socialAccount.findMany({ where: { organizationId: org, status: { not: "DISCONNECTED" } }, orderBy: [{ platform: "asc" }, { name: "asc" }] }),
  ]);
  const groups = [{ id: null as string | null, name: "Our own accounts" }, ...clients].map((c) => ({ ...c, accounts: accounts.filter((a) => (a.clientId ?? null) === c.id) })).filter((g) => g.accounts.length > 0);
  const isAdmin = user.permissions.has("integrations.manage");

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/content", label: "Content calendar" }} title="Social accounts"
        subtitle="Facebook Pages and Instagram accounts that approved posts go out to automatically. Connect them per client: the client (or whoever manages their Page) signs in with Facebook once." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      {!app ? (
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold">Set up the Meta app first</h2>
          <p>Posting to Facebook and Instagram goes through the company&rsquo;s own Meta app. A Super Admin enters its app ID and app secret in Settings → Integrations.</p>
          <p className="text-muted">In the Meta app, add this as a valid OAuth redirect URI: <code className="break-all">{callbackUrl()}</code></p>
        </section>
      ) : (
        <form method="get" action="/api/social/meta/connect" className="card flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><label className="label" htmlFor="sa-client">Accounts for</label>
            <select id="sa-client" name="client" className="input" defaultValue="own"><option value="own">Our own accounts</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <button className="btn">Connect with Facebook</button>
          <p className="w-full text-xs text-muted">Facebook asks which Pages to share. Tick the client&rsquo;s Page; its Instagram account comes with it when the two are linked in Meta Business Suite. Instagram must be a Business or Creator account.</p>
        </form>
      )}

      {groups.length === 0 ? <p className="text-sm text-muted">No accounts connected yet.</p> : groups.map((g) => (
        <section key={g.id ?? "own"} className="card space-y-2" aria-label={g.name}>
          <h2 className="font-semibold">{g.name}</h2>
          <ul className="divide-y divide-border">
            {g.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <PlatformDot code={PLATFORM_META[a.platform]?.code ?? "?"} color={PLATFORM_META[a.platform]?.color ?? "#6b7280"} size={22} />
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{a.name}{a.username ? <span className="font-normal text-muted"> @{a.username}</span> : null}</p>
                  <p className="text-xs text-muted">{PLATFORM_META[a.platform]?.label} · connected {a.connectedAt.toLocaleDateString("en-GB")}</p>
                  {a.lastError && <p className="text-xs text-brand">{a.lastError}</p>}
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${(STATUS[a.status] ?? STATUS.EXPIRED).cls}`}>{(STATUS[a.status] ?? STATUS.EXPIRED).label}</span>
                <form action={checkAccountAction}><input type="hidden" name="id" value={a.id} /><SubmitButton className="btn-ghost" pendingText="Checking…">Check</SubmitButton></form>
                <form action={disconnectAccountAction}><input type="hidden" name="id" value={a.id} />
                  <ConfirmButton title={`Disconnect ${a.name}?`} message="Its token is deleted. Posts waiting to go out to it will stop and show as failed. You can connect it again later." confirmLabel="Disconnect">Disconnect</ConfirmButton></form>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {app && isAdmin && <p className="text-xs text-muted">Meta app redirect URI: <code className="break-all">{callbackUrl()}</code></p>}
    </div>
  );
}
