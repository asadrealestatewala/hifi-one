import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_LABEL, isStale } from "@/lib/solution-feed";
import { Badge, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import FeedKeyForm from "./FeedKeyForm";
import { linkWorkspaceAction, removeFeedKeyAction } from "./actions";

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
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: { sortOrder: "asc" }, include: { feedKey: { select: { hint: true, lastReportAt: true, rotatedAt: true } } } }),
    db.solutionWorkspace.findMany({ where: { organizationId: org }, orderBy: [{ clientId: { sort: "asc", nulls: "first" } }, { name: "asc" }], take: 500, include: { product: { select: { name: true } }, client: { select: { name: true } } } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
  ]);
  const unlinked = workspaces.filter((w) => !w.clientId);
  return (
    <div className="space-y-5">
      <PageHeader title="Live Solutions" subtitle="What each Solution reports about its client workspaces: status and usage counts only, never client records. Partners and sales agents see the workspaces linked to their own clients." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card space-y-3" aria-label="Feeds">
        <h2 className="font-semibold">Feeds</h2>
        <ul className="divide-y divide-border">
          {products.map((p) => {
            const stale = p.feedKey?.lastReportAt ? isStale(p.feedKey.lastReportAt, now) : false;
            return (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="space-y-1">
                  <p className="font-medium">{p.name} <span className="text-xs text-muted">({p.code})</span></p>
                  <p className="text-xs text-muted">Reports are posted to <code>/api/solution-feed/{p.code}</code></p>
                  {!p.feedKey ? <Badge>Not configured</Badge> : !p.feedKey.lastReportAt ? <Badge tone="warning">Secret created, waiting for the first report</Badge> : stale ? <Badge tone="warning">Not reporting since {when(p.feedKey.lastReportAt)}</Badge> : <Badge tone="success">Reporting, last at {when(p.feedKey.lastReportAt)}</Badge>}
                </div>
                {canKeys ? (
                  <div className="space-y-2">
                    <FeedKeyForm productId={p.id} hasKey={Boolean(p.feedKey)} />
                    {p.feedKey && (
                      <form action={removeFeedKeyAction}>
                        <input type="hidden" name="productId" value={p.id} />
                        <ConfirmButton title={`Switch off the ${p.name} feed?`} message="Reports from this Solution are refused until a new secret is created. Figures already received stay visible but go out of date." confirmLabel="Switch off">Switch off</ConfirmButton>
                      </form>
                    )}
                  </div>
                ) : <p className="text-xs text-muted">Only a Super Admin manages secrets.</p>}
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
