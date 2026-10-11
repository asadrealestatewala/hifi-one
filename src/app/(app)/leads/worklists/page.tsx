import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { WorklistError, addSuppression, importWorklist, worklistMetrics } from "@/lib/worklists";

export const dynamic = "force-dynamic";

async function upload(formData: FormData) {
  "use server";
  const user = await requirePermission("crm.edit");
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (file instanceof File && file.size > 5_000_000) redirect(`/leads/worklists?error=${encodeURIComponent("File is too large (5 MB limit).")}`);
  let id: string;
  let summary: string;
  try {
    const r = await importWorklist(db, {
      organizationId: user.organizationId, name: String(formData.get("name") ?? ""), source: String(formData.get("source") ?? ""), assignedToId: user.id,
      targetDate: String(formData.get("targetDate") ?? ""), csv: text, createdById: user.id,
    });
    id = r.worklistId;
    summary = `Imported ${r.imported} rows. Skipped ${r.skipped.length}. Already in CRM: ${r.duplicates}. Do-not-contact: ${r.suppressed}.`;
    await audit(user, { action: "worklist.import", entity: "Worklist", entityId: id, after: { imported: r.imported, skipped: r.skipped.length } });
    // The skipped-row report travels with the redirect so nothing is silently dropped
    const report = r.skipped.slice(0, 50).map((s) => `Row ${s.row}: ${s.reason}`).join("\n");
    redirect(`/leads/worklists/${id}?summary=${encodeURIComponent(summary)}&skipped=${encodeURIComponent(report)}`);
  } catch (e) {
    if (e instanceof WorklistError) redirect(`/leads/worklists?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

async function suppress(formData: FormData) {
  "use server";
  const user = await requirePermission("crm.edit");
  try {
    await addSuppression(db, { organizationId: user.organizationId, email: String(formData.get("email") ?? ""), phone: String(formData.get("phone") ?? ""), reason: String(formData.get("reason") ?? "") });
    await audit(user, { action: "suppression.add", entity: "SuppressedContact" });
  } catch (e) {
    if (e instanceof WorklistError) redirect(`/leads/worklists?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/leads/worklists");
}

export default async function Worklists({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("crm.view");
  const { error } = await searchParams;
  const canEdit = user.permissions.has("crm.edit");
  const lists = await db.worklist.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" } });
  const metrics = await Promise.all(lists.map((l) => worklistMetrics(db, l.id)));
  const suppressed = await db.suppressedContact.count({ where: { organizationId: user.organizationId } });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prospecting Worklists</h1>
      <p className="text-sm text-muted">Raw outreach lists live here, apart from the CRM, so unqualified records never inflate lead numbers. A row becomes a lead only when you convert it. Only legally sourced contacts belong in a worklist; respect local outreach and privacy rules.</p>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card overflow-x-auto">
        {lists.length === 0 ? <p className="text-sm text-muted">No worklists yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Worklist</th><th className="pr-4">Source</th><th className="pr-4 text-right">Records</th><th className="pr-4 text-right">Processed</th><th className="text-right">CRM leads generated</th></tr></thead>
            <tbody>
              {lists.map((l, i) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium"><Link className="hover:underline" href={`/leads/worklists/${l.id}`}>{l.name}</Link></td><td className="pr-4">{l.source}</td>
                  <td className="pr-4 text-right">{metrics[i].total}</td><td className="pr-4 text-right">{metrics[i].processed}</td><td className="text-right font-semibold">{metrics[i].leadsGenerated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canEdit && (
        <>
          <form action={upload} className="card grid gap-3 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Import a list (CSV)</h2>
            <p className="text-xs text-muted sm:col-span-2">Needs a header row. Recognised columns: Name, Company, Email, Phone, Country, Source. Other columns are kept as they are. Invalid and duplicate rows are skipped and reported. Excel files: save as CSV first.</p>
            <div><label className="label" htmlFor="name">Worklist name</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="source">Source</label><input id="source" name="source" placeholder="Trade expo, directory…" className="input" /></div>
            <div><label className="label" htmlFor="targetDate">Target completion</label><input id="targetDate" name="targetDate" type="date" className="input" /></div>
            <div><label className="label" htmlFor="file">CSV file</label><input id="file" name="file" type="file" accept=".csv,text/csv" className="input" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="csv">…or paste CSV text</label><textarea id="csv" name="csv" rows={4} className="input font-mono text-xs" /></div>
            <div className="sm:col-span-2"><button className="btn">Import</button></div>
          </form>
          <form action={suppress} className="card flex flex-wrap items-end gap-3">
            <div className="w-full"><h2 className="font-semibold">Do-not-contact list ({suppressed})</h2><p className="text-xs text-muted">Contacts here are blocked from outreach and from becoming leads, including rows already imported.</p></div>
            <div><label className="label" htmlFor="semail">Email</label><input id="semail" name="email" type="email" className="input" /></div>
            <div><label className="label" htmlFor="sphone">Phone</label><input id="sphone" name="phone" className="input" /></div>
            <div><label className="label" htmlFor="sreason">Reason</label><input id="sreason" name="reason" className="input" /></div>
            <button className="btn-ghost">Add</button>
          </form>
        </>
      )}
    </div>
  );
}
