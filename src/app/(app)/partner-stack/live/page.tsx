import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_LABEL, isStale } from "@/lib/solution-feed";
import { Badge, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import FeedKeyForm from "./FeedKeyForm";
import { connectSolutionAction, disconnectSolutionAction, linkWorkspaceAction, pullNowAction, removeFeedKeyAction } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { LIVE: "success", TRIAL: "neutral", OVERDUE: "warning", SUSPENDED: "danger", CANCELLED: "neutral" };
const when = (d: Date | null) => (d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "No activity reported");

// Live Solutions: what each Solution reports about its client workspaces, and which Hifi One client each one belongs to.
export default async function LiveSolutions({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; view?: string }> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const canKeys = user.permissions.has("integrations.manage") && user.roleKeys.includes("SUPER_ADMIN");
  const org = user.organizationId;
  const now = new Date();
  const [products, workspaces, clients] = await Promise.all([
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: { sortOrder: "asc" }, include: { feedKey: { select: { hint: true, lastReportAt: true, rotatedAt: true } }, connection: { select: { baseUrl: true, hint: true, lastOkAt: true, lastError: true } } } }),
    db.solutionWorkspace.findMany({ where: { organizationId: org }, orderBy: [{ clientId: { sort: "asc", nulls: "first" } }, { name: "asc" }], take: 500, include: { product: { select: { name: true } }, client: { select: { name: true } } } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
  ]);
  const unlinked = workspaces.filter((w) => !w.clientId);
  return (
    <div className="space-y-5">
      <PageHeader title="Live Solutions" subtitle="What each Solution reports about its client workspaces: status and usage counts only, never client records. Partners and sales agents see the workspaces linked to their own clients." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card space-y-3" aria-label="Connections">
        <h2 className="font-semibold">Connections</h2>
        <p className="text-sm text-muted">In each Solution&rsquo;s own admin console, open Hifi One connection and generate an API key. Paste it here with the Solution&rsquo;s address. Hifi One then reads the summary every 15 minutes.</p>
        <ul className="divide-y divide-border">
          {products.map((p) => {
            const c = p.connection;
            const pushStale = p.feedKey?.lastReportAt ? isStale(p.feedKey.lastReportAt, now) : false;
            return (
              <li key={p.id} className="space-y-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  {c ? (c.lastError ? <Badge tone="danger">Connected, last read failed</Badge> : c.lastOkAt && !isStale(c.lastOkAt, now) ? <Badge tone="success">Connected, read {when(c.lastOkAt)}</Badge> : <Badge tone="warning">Connected, not read recently</Badge>)
                    : p.feedKey ? (p.feedKey.lastReportAt && !pushStale ? <Badge tone="success">Sending, last at {when(p.feedKey.lastReportAt)}</Badge> : <Badge tone="warning">Waiting for the Solution to send</Badge>)
                    : <Badge>Not configured</Badge>}
                </div>
                {c && <p className="text-xs text-muted">{c.baseUrl} · key ends in <code>{c.hint}</code>{c.lastError && <> · <span className="text-brand">{c.lastError}</span></>}</p>}
                {canKeys ? (
                  <div className="space-y-3">
                    <form action={connectSolutionAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="productId" value={p.id} />
                      <div className="min-w-56 flex-1"><label className="label" htmlFor={`u-${p.id}`}>Solution address</label>
                        <input id={`u-${p.id}`} name="baseUrl" type="text" inputMode="url" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false} required defaultValue={c?.baseUrl ?? p.website ?? ""} placeholder="https://campusly.co" className="input" /></div>
                      <div className="min-w-56 flex-1"><label className="label" htmlFor={`k-${p.id}`}>{c ? "New API key" : "API key"}</label>
                        <input id={`k-${p.id}`} name="apiKey" type="text" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false} required minLength={20} maxLength={400} placeholder="Paste the key" className="input font-mono" /></div>
                      <SubmitButton pendingText="Connecting…">{c ? "Reconnect" : "Connect"}</SubmitButton>
                    </form>
                    {c && (
                      <div className="flex flex-wrap gap-2">
                        <form action={pullNowAction}><input type="hidden" name="productId" value={p.id} /><SubmitButton className="btn-ghost" pendingText="Reading…">Read now</SubmitButton></form>
                        <form action={disconnectSolutionAction}>
                          <input type="hidden" name="productId" value={p.id} />
                          <ConfirmButton title={`Disconnect ${p.name}?`} message="Hifi One stops reading this Solution. Figures already read stay visible but go out of date." confirmLabel="Disconnect">Disconnect</ConfirmButton>
                        </form>
                      </div>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted">Other way: the Solution sends its figures to Hifi One</summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-muted">For a Solution that cannot be read from outside. It posts signed reports to <code>/api/solution-feed/{p.code}</code> with this secret.</p>
                        <FeedKeyForm productId={p.id} hasKey={Boolean(p.feedKey)} />
                        {p.feedKey && (
                          <form action={removeFeedKeyAction}>
                            <input type="hidden" name="productId" value={p.id} />
                            <ConfirmButton title={`Switch off sending for ${p.name}?`} message="Reports sent by this Solution are refused until a new secret is created." confirmLabel="Switch off">Switch off sending</ConfirmButton>
                          </form>
                        )}
                      </div>
                    </details>
                  </div>
                ) : <p className="text-xs text-muted">Only a Super Admin connects Solutions.</p>}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card !p-0 overflow-x-auto" aria-label="Workspaces">
        <div className="px-4 pt-3"><h2 className="font-semibold">Client workspaces{unlinked.length > 0 && <> <Badge tone="warning">{unlinked.length} not linked</Badge></>}</h2></div>
        {workspaces.length === 0 ? <div className="p-4"><Empty title="Nothing reported yet">When a Solution sends its first report, its client workspaces appear here. Link each one to the Hifi One client it belongs to.</Empty></div> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Workspace</th><th className="pr-4">Solution</th><th className="pr-4">Status</th><th className="pr-4">Users</th><th className="pr-4">Units</th><th className="pr-4">Last activity</th><th className="pr-4">Linked client</th></tr></thead>
            <tbody className="divide-y divide-border">
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2.5">{w.name}<div className="text-xs text-muted">{w.externalId}</div></td>
                  <td className="pr-4">{w.product.name}</td>
                  <td className="pr-4 whitespace-nowrap"><Badge tone={TONE[w.status] ?? "neutral"}>{STATUS_LABEL[w.status] ?? w.status}</Badge>{isStale(w.receivedAt, now) && <div className="text-xs text-muted">Out of date</div>}</td>
                  <td className="pr-4">{w.activeUsers ?? "–"}</td>
                  <td className="pr-4 whitespace-nowrap">{w.units ?? "–"}{w.unitLabel ? ` ${w.unitLabel}` : ""}</td>
                  <td className="pr-4 whitespace-nowrap">{when(w.lastActivityAt)}</td>
                  <td className="pr-4">
                    <form action={linkWorkspaceAction} className="flex items-center gap-1">
                      <input type="hidden" name="workspaceId" value={w.id} />
                      <label className="sr-only" htmlFor={`c-${w.id}`}>Client for {w.name}</label>
                      <select id={`c-${w.id}`} name="clientId" defaultValue={w.clientId ?? ""} className="input w-48">
                        <option value="">Not linked</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <SubmitButton className="btn-ghost text-xs" pendingText="Saving…">Save</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
