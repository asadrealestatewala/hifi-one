import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONDITIONS, CONDITION_LABEL, ITEM_CATEGORIES, WRITE_OFF_LABEL, WRITE_OFF_REASONS } from "@/lib/asset-custody";
import { formatMoney } from "@/lib/money";
import { Badge, ConfirmButton, Notice, PageHeader, PanelForm, SubmitButton } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import FilesPanel from "@/components/FilesPanel";
import { issueItemAction, returnItemAction, updateItemAction, writeOffItemAction } from "../actions";

export const dynamic = "force-dynamic";

const when = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
type SP = { edit?: string; error?: string; msg?: string; fileError?: string; fileOk?: string };

// One company item: its details, who has it, issue or take back, photos and papers, and every handover it has been through.
export default async function CompanyAsset({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("assets.custody");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const a = await db.asset.findFirst({ where: { id, organizationId: org } });
  if (!a) notFound();
  const [history, staff] = await Promise.all([
    db.assetAssignment.findMany({ where: { assetId: a.id }, orderBy: { assignedAt: "desc" } }),
    db.user.findMany({ where: { organizationId: org, active: true, userType: "EMPLOYEE", NOT: { employeeProfile: { status: "EXITED" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const ids = [...new Set([a.assignedToId, a.createdById, ...history.flatMap((h) => [h.userId, h.issuedById, h.returnedById])].filter((x): x is string => Boolean(x)))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, employeeProfile: { select: { id: true, status: true } } } })).map((u) => [u.id, u]));
  const nm = (i: string | null) => (i ? names.get(i)?.name ?? "Unknown" : "");
  const open = history.find((h) => !h.returnedAt);
  const active = a.status === "ACTIVE";
  const holderProfile = a.assignedToId ? names.get(a.assignedToId)?.employeeProfile?.id : undefined;
  const holderLeft = a.assignedToId ? names.get(a.assignedToId)?.employeeProfile?.status === "EXITED" : false;
  const seeCost = !a.inBooks ? Number(a.cost) > 0 : user.permissions.has("assets.view");
  const editTo = `/hr/assets/${a.id}`;
  const facts: [string, React.ReactNode][] = [
    ["Tag", a.number], ["Category", a.category ?? "Uncategorised"], ["Serial or IMEI", a.serialNumber], ["Condition", CONDITION_LABEL[a.condition] ?? a.condition],
    ["Kept at", a.location], ["With", a.assignedToId ? (holderProfile && user.permissions.has("hr.view") ? <Link key="w" className="underline" href={`/hr/employees/${holderProfile}#items`}>{nm(a.assignedToId)}</Link> : nm(a.assignedToId)) : active ? "In stock" : null],
    ["Bought", a.purchaseDate], ["Cost", seeCost ? `${formatMoney(a.cost, a.currency)}${a.inBooks ? "" : " (for reference)"}` : null],
    ["Recorded by", a.createdById ? nm(a.createdById) : a.inBooks ? "Finance, under Fixed assets" : null],
    ["Closed", !active ? (a.inBooks ? `Disposed of by Finance on ${a.disposedDate}` : `Written off on ${a.disposedDate}: ${WRITE_OFF_LABEL[(a.writeOffReason ?? "").split(":")[0]] ?? ""}${a.writeOffReason?.includes(":") ? `, ${a.writeOffReason.split(":").slice(1).join(":").trim()}` : ""}`) : null],
    ["Notes", a.notes],
  ];

  return (
    <div className="space-y-5">
      <PageHeader back={{ href: "/hr/assets", label: "Company assets" }} title={a.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{a.number}{a.inBooks ? <Badge tone="info">in the books</Badge> : <Badge tone="neutral">recorded by HR, not in the books</Badge>}{!active && <Badge tone="neutral">{a.inBooks ? "disposed" : "written off"}</Badge>}</span>}
        actions={<>
          {a.inBooks && user.permissions.has("assets.view") && <Link href={`/assets/${a.id}`} className="btn-ghost">Finance record</Link>}
          {active && <Link href={`${editTo}?edit=1`} className="btn-ghost">Edit details</Link>}
        </>} />
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.error && !sp.edit && <Notice kind="error">{sp.error}</Notice>}
      {holderLeft && <Notice kind="error">{nm(a.assignedToId)} has left the company and still has this item. Take it back, or record it as not returned.</Notice>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="card">
          <h2 className="mb-2 font-semibold">Details</h2>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
            {facts.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
          </dl>
        </section>

        {active && (
          <section className="card space-y-3">
            {!a.assignedToId ? (
              <form action={issueItemAction} className="space-y-3">
                <h2 className="font-semibold">Issue to someone</h2>
                <input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="returnTo" value={editTo} />
                <div><label className="label" htmlFor="userId">Employee</label>
                  <select id="userId" name="userId" required className="input" defaultValue=""><option value="" disabled>Choose a person</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label className="label" htmlFor="condition-out">Condition when handed over</label>
                  <select id="condition-out" name="condition" className="input" defaultValue={a.condition}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</select></div>
                <p className="text-xs text-muted">They are notified and asked to confirm receipt on their profile.</p>
                <SubmitButton pendingText="Issuing…">Issue item</SubmitButton>
              </form>
            ) : (
              <form action={returnItemAction} className="space-y-3">
                <h2 className="font-semibold">Take back from {nm(a.assignedToId)}</h2>
                <p className="text-xs text-muted">With them since {when(open?.assignedAt)}{open && !open.acknowledgedAt ? ". They have not confirmed receipt yet." : open?.acknowledgedAt ? `, receipt confirmed ${when(open.acknowledgedAt)}.` : "."}</p>
                <input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="returnTo" value={editTo} />
                <div><label className="label" htmlFor="condition-in">Condition it came back in</label>
                  <select id="condition-in" name="condition" className="input" defaultValue={a.condition}>{[...CONDITIONS, "LOST"].map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</select></div>
                <div><label className="label" htmlFor="note">Note (needed if not returned)</label><input id="note" name="note" maxLength={500} className="input" placeholder="Charger missing" /></div>
                <SubmitButton pendingText="Saving…">Take back</SubmitButton>
              </form>
            )}
            {!a.inBooks && (
              <form action={writeOffItemAction} className="space-y-2 border-t border-border pt-3">
                <h3 className="text-sm font-semibold">Write off</h3>
                <input type="hidden" name="assetId" value={a.id} />
                <div><label className="label" htmlFor="writeOffReason">Why</label>
                  <select id="writeOffReason" name="writeOffReason" required className="input" defaultValue=""><option value="" disabled>Choose</option>{WRITE_OFF_REASONS.map((r) => <option key={r} value={r}>{WRITE_OFF_LABEL[r]}</option>)}</select></div>
                <ConfirmButton title={`Write off ${a.name}?`} message="The item leaves the register for good. Its record and handover history are kept. Say what happened." confirmLabel="Write off" reason>Write off</ConfirmButton>
              </form>
            )}
            {a.inBooks && <p className="border-t border-border pt-3 text-xs text-muted">This item is in the books. If it is lost or scrapped, Finance disposes of it under Fixed assets so the loss is recorded.</p>}
          </section>
        )}
      </div>

      <section className="card !p-0">
        <h2 className="border-b border-border px-5 py-3 font-semibold">Handover history ({history.length})</h2>
        {history.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Never issued.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-5 py-2.5">Person</th><th className="pr-4">Issued</th><th className="pr-4">Receipt</th><th className="pr-4">Returned</th><th className="pr-4">Note</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id} className="border-t border-border align-top">
                <td className="px-5 py-2.5 font-medium">{nm(h.userId)}{h.requestId && <span className="block text-xs font-normal text-muted"><Link className="underline" href={`/hr/requests?status=ALL&type=EQUIPMENT&focus=${h.requestId}#${h.requestId}`}>Answered an equipment request</Link></span>}</td>
                <td className="py-2.5 pr-4">{when(h.assignedAt)}<span className="block text-xs text-muted">{[h.issuedById && `by ${nm(h.issuedById)}`, h.conditionOut && CONDITION_LABEL[h.conditionOut]].filter(Boolean).join(" · ")}</span></td>
                <td className="py-2.5 pr-4">{h.acknowledgedAt ? when(h.acknowledgedAt) : h.returnedAt ? <span className="text-muted">Not confirmed</span> : <Badge tone="warning">waiting</Badge>}</td>
                <td className="py-2.5 pr-4">{h.returnedAt ? <>{when(h.returnedAt)}<span className="block text-xs text-muted">{[h.returnedById && `by ${nm(h.returnedById)}`, h.conditionIn && CONDITION_LABEL[h.conditionIn]].filter(Boolean).join(" · ")}</span></> : <span className="text-muted">Still with them</span>}</td>
                <td className="py-2.5 pr-4 text-muted">{h.returnNote}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <FilesPanel user={user} ownerType="ASSET" ownerId={a.id} returnTo={editTo} title="Photos and papers" flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />

      {active && sp.edit && (
        <Drawer title="Edit details" closeTo={editTo}>
          <PanelForm action={updateItemAction} closeTo={editTo} submit="Save" error={sp.error} hint={a.inBooks ? "Name, category and cost belong to Finance's record." : undefined}>
            <input type="hidden" name="id" value={a.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              {!a.inBooks && <>
                <div className="sm:col-span-2"><label className="label" htmlFor="name">Item</label><input id="name" name="name" required minLength={2} maxLength={120} defaultValue={a.name} className="input" /></div>
                <div><label className="label" htmlFor="category">Category</label><select id="category" name="category" className="input" defaultValue={a.category ?? "Other"}>{ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              </>}
              <div><label className="label" htmlFor="condition">Condition</label><select id="condition" name="condition" className="input" defaultValue={a.condition}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</select></div>
              <div><label className="label" htmlFor="serialNumber">Serial or IMEI number</label><input id="serialNumber" name="serialNumber" maxLength={80} defaultValue={a.serialNumber ?? ""} className="input" /></div>
              <div><label className="label" htmlFor="location">Where it is kept</label><input id="location" name="location" maxLength={120} defaultValue={a.location ?? ""} className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" maxLength={1000} rows={3} defaultValue={a.notes ?? ""} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
