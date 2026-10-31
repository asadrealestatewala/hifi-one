import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGREEMENT_STATUSES, PLACEHOLDERS, TEMPLATE_KINDS } from "@/lib/agreements";
import { paging } from "@/lib/paging";
import { Chips, Empty, NewButton, PageHeader, PanelForm, Pager, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import { createAgreementAction, saveTemplateAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { tab?: string; status?: string; q?: string; new?: string; error?: string; page?: string; template?: string };

export default async function Agreements({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("contracts.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("contracts.manage");
  const tab = sp.tab === "templates" ? "templates" : "agreements";
  const q = sp.q?.trim();
  const status = (AGREEMENT_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all";
  const where = { organizationId: org, ...(status === "all" ? {} : { status }), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { number: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const pg = paging(sp.page);
  const [rows, matched, counts, templates, clients, vendors] = await Promise.all([
    tab === "agreements" ? db.agreement.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }) : [],
    tab === "agreements" ? db.agreement.count({ where }) : 0,
    db.agreement.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.documentTemplate.findMany({ where: { organizationId: org }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    sp.new && canManage && tab === "agreements" ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    sp.new && canManage && tab === "agreements" ? db.vendor.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const count = new Map(counts.map((c) => [c.status as string, c._count]));
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const clientNames = new Map((await db.client.findMany({ where: { id: { in: rows.map((r) => r.clientId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const vendorNames = new Map((await db.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  const editing = sp.template ? templates.find((t) => t.id === sp.template) : undefined;
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ tab: tab === "agreements" ? undefined : tab, status: status === "all" ? undefined : status, q, ...over })) if (v) p.set(k, v); const t = p.toString(); return t ? `/agreements?${t}` : "/agreements"; };
  return (
    <div className="space-y-5">
      <PageHeader title="Agreements" subtitle="Write an agreement from a template, send a one-time link, and keep the signed copy." actions={canManage ? <NewButton href={href({ new: "1" })}>{tab === "templates" ? "New template" : "New agreement"}</NewButton> : undefined} />
      <Chips current={tab} items={[{ key: "agreements", label: "Agreements", count: total, href: "/agreements" }, { key: "templates", label: "Templates", count: templates.length, href: "/agreements?tab=templates" }]} />

      {tab === "agreements" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Waiting for signature" value={count.get("SENT") ?? 0} href={href({ status: "SENT", page: undefined })} />
            <Stat label="Signed" value={count.get("SIGNED") ?? 0} href={href({ status: "SIGNED", page: undefined })} />
            <Stat label="Declined" value={count.get("DECLINED") ?? 0} href={href({ status: "DECLINED", page: undefined })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox q={q} placeholder="Search title or number" hidden={{ status: status === "all" ? undefined : status }} />
            <Chips current={status} items={[{ key: "all", label: "All", count: total, href: href({ status: undefined, page: undefined }) }, ...AGREEMENT_STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: count.get(s) ?? 0, href: href({ status: s, page: undefined }) }))]} />
          </div>
          {rows.length === 0 ? <Empty title={q || status !== "all" ? "No agreements match" : "No agreements yet"}>{canManage ? "Create one with New agreement. Start from a template to save typing." : "Agreements will appear here."}</Empty> : (
            <div className="card overflow-x-auto !p-0">
              <table className="w-full text-sm">
                <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Agreement</th><th className="pr-4">With</th><th className="pr-4">Status</th><th className="pr-4">Sent</th><th className="pr-4">Signed</th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-t border-border transition hover:bg-hover/50">
                      <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/agreements/${a.id}`}>{a.title}</Link><div className="text-xs text-muted">{a.number}</div></td>
                      <td className="pr-4">{(a.clientId && clientNames.get(a.clientId)) || (a.vendorId && vendorNames.get(a.vendorId)) || ""}</td>
                      <td className="pr-4"><StatusBadge status={a.status} /></td>
                      <td className="pr-4 text-muted">{a.sentAt?.toISOString().slice(0, 10) ?? ""}</td>
                      <td className="pr-4 text-muted">{a.signedAt?.toISOString().slice(0, 10) ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </>
      )}

      {tab === "templates" && (
        templates.length === 0 ? <Empty title="No templates yet">{canManage ? "Add a template once and reuse it. Use placeholders such as {{client_name}} and {{date}}." : "Templates will appear here."}</Empty> : (
          <div className="card overflow-x-auto !p-0">
            <table className="w-full text-sm">
              <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Template</th><th className="pr-4">Kind</th><th className="pr-4">Placeholders</th><th className="pr-4">State</th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-3 font-medium">{canManage ? <Link className="hover:underline" href={href({ new: "1", template: t.id })}>{t.name}</Link> : t.name}</td>
                    <td className="pr-4 text-muted">{t.kind.toLowerCase()}</td>
                    <td className="pr-4 text-xs text-muted">{[...new Set([...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))].join(", ")}</td>
                    <td className="pr-4"><StatusBadge status={t.active ? "ACTIVE" : "ENDED"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {canManage && sp.new && tab === "agreements" && (
        <Drawer title="New agreement" closeTo={href({ new: undefined })}>
          <PanelForm action={createAgreementAction} closeTo={href({ new: undefined })} submit="Create draft" error={sp.error} hint="Saved as a draft. You review it and send it on the next page.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="ag-title">Title</label><input id="ag-title" name="title" required maxLength={160} className="input" placeholder="e.g. Social media management agreement" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="ag-party">With</label>
                <select id="ag-party" name="party" required className="input"><option value="">Choose a client or vendor…</option>
                  <optgroup label="Clients">{clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup>
                  <optgroup label="Vendors">{vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name}</option>)}</optgroup>
                </select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="ag-tpl">Template</label>
                <select id="ag-tpl" name="templateId" className="input"><option value="">None, I will type the text</option>{templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
              <div><label className="label" htmlFor="ag-amt">Amount (optional)</label><input id="ag-amt" name="amount" maxLength={40} className="input" placeholder="USD 1,200 per month" /></div>
              <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="ag-from">Starts</label><input id="ag-from" name="startDate" type="date" className="input" /></div><div><label className="label" htmlFor="ag-to">Ends</label><input id="ag-to" name="endDate" type="date" className="input" /></div></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="ag-body">Text (used when no template is chosen)</label><textarea id="ag-body" name="body" rows={6} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}

      {canManage && sp.new && tab === "templates" && (
        <Drawer title={editing ? "Edit template" : "New template"} closeTo={href({ new: undefined, template: undefined })}>
          <PanelForm action={saveTemplateAction} closeTo={href({ new: undefined, template: undefined })} submit="Save template" error={sp.error} hint={`Placeholders: ${PLACEHOLDERS.map((k) => `{{${k}}}`).join(" ")}`}>
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="tp-name">Name</label><input id="tp-name" name="name" required maxLength={80} defaultValue={editing?.name} className="input" /></div>
              <div><label className="label" htmlFor="tp-kind">Kind</label><select id="tp-kind" name="kind" defaultValue={editing?.kind ?? "CONTRACT"} className="input">{TEMPLATE_KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}</select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="tp-body">Text</label><textarea id="tp-body" name="body" rows={14} required defaultValue={editing?.body} className="input font-mono text-xs" /></div>
              {editing && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="hidden" name="active" value="0" /><input type="checkbox" name="active" value="1" defaultChecked={editing.active} /> Available when creating agreements</label>}
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
