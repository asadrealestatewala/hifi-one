import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { Notice, Pager } from "@/components/ui";
import { WorklistError, convertRow, setRowStatus, worklistMetrics } from "@/lib/worklists";

export const dynamic = "force-dynamic";

async function act(formData: FormData) {
  "use server";
  const user = await requirePermission("crm.edit");
  const id = String(formData.get("listId"));
  const op = String(formData.get("op"));
  try {
    if (op === "convert") {
      const r = await convertRow(db, { organizationId: user.organizationId, rowId: String(formData.get("id")), actorId: user.id });
      await audit(user, { action: "worklist.convert_row", entity: "Lead", entityId: r.leadId });
    } else {
      await setRowStatus(db, { organizationId: user.organizationId, rowId: String(formData.get("id")), status: op, note: String(formData.get("note") ?? "") });
    }
  } catch (e) {
    if (e instanceof WorklistError) redirect(`/leads/worklists/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/leads/worklists/${id}`);
}

const LABEL = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function WorklistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; summary?: string; skipped?: string; status?: string; page?: string }> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const { error, summary, skipped, status, page } = await searchParams;
  const pg = paging(page);
  const wl = await db.worklist.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!wl) notFound();
  const canEdit = user.permissions.has("crm.edit");
  const rowWhere = { worklistId: id, ...(status ? { status } : {}) };
  const [rows, matched, m] = await Promise.all([
    db.worklistRow.findMany({ where: rowWhere, orderBy: [{ rowNumber: "asc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.worklistRow.count({ where: rowWhere }),
    worklistMetrics(db, id),
  ]);
  return (
    <div className="space-y-6">
      <Link href="/leads/worklists" className="text-sm text-muted hover:underline">← All worklists</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{wl.name} <span className="text-base font-normal text-muted">{wl.source}</span></h1>
      {summary && <Notice kind="ok">{summary}</Notice>}
      {skipped && <pre className="card text-xs whitespace-pre-wrap">Skipped rows (not imported):{"\n"}{skipped}</pre>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-5">
        {([["Records", m.total], ["Processed", m.processed], ["Still to do", m.remaining], ["Do not contact", m.doNotContact], ["CRM leads generated", m.leadsGenerated]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="card"><p className="text-xs font-semibold text-muted">{k}</p><p className="text-2xl font-bold">{v}</p></div>
        ))}
      </div>
      <nav aria-label="Status filter" className="flex flex-wrap gap-1">
        {["", "NEW", "CONTACTED", "NOT_INTERESTED", "DO_NOT_CONTACT", "CONVERTED"].map((s) => (
          <Link key={s} href={s ? `/leads/worklists/${id}?status=${s}` : `/leads/worklists/${id}`} className={`btn-ghost ${(status ?? "") === s ? "!bg-navy !text-white" : ""}`}>{s ? LABEL(s) : "All"}</Link>
        ))}
      </nav>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-3">Row</th><th className="pr-3">Name</th><th className="pr-3">Email</th><th className="pr-3">Phone</th><th className="pr-3">Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-2 pr-3 text-muted">{r.rowNumber}</td>
                <td className="pr-3">{r.name}{r.company && <span className="block text-xs text-muted">{r.company}</span>}</td>
                <td className="pr-3">{r.email}</td><td className="pr-3">{r.phone}</td>
                <td className="pr-3">{LABEL(r.status)}{r.duplicateLeadId && r.status === "NEW" && <span className="block text-xs text-brand">Already in CRM: <Link className="underline" href={`/leads/${r.duplicateLeadId}`}>open lead</Link></span>}
                  {r.convertedLeadId && <Link className="block text-xs underline" href={`/leads/${r.convertedLeadId}`}>Open lead</Link>}</td>
                <td className="py-1">
                  {canEdit && ["NEW", "CONTACTED", "NOT_INTERESTED"].includes(r.status) && (
                    <div className="flex flex-wrap gap-1">
                      {([["CONTACTED", "Contacted"], ["NOT_INTERESTED", "Not interested"]] as const).map(([op, label]) => (
                        <form key={op} action={act}><input type="hidden" name="listId" value={id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value={op} /><button className="btn-ghost">{label}</button></form>
                      ))}
                      {!r.duplicateLeadId && <form action={act}><input type="hidden" name="listId" value={id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="convert" /><button className="btn">Make CRM lead</button></form>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={pg.page} size={pg.size} total={matched} href={(n) => { const p = new URLSearchParams(); if (status) p.set("status", status); if (n > 1) p.set("page", String(n)); const t = p.toString(); return `/leads/worklists/${id}${t ? `?${t}` : ""}`; }} />
      </div>
    </div>
  );
}
