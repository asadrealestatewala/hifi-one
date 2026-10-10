import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { createLead } from "./actions";

export const dynamic = "force-dynamic";

export default async function Leads({ searchParams }: { searchParams: Promise<{ error?: string; dup?: string; q?: string }> }) {
  const user = await requirePermission("crm.view");
  const { error, dup, q } = await searchParams;
  const canEdit = user.permissions.has("crm.edit");
  const search = q?.trim();
  const leads = await db.lead.findMany({
    where: {
      ...leadScope(user),
      ...(search
        ? { AND: [{ OR: [
            { name: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ] }] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { stage: true },
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted">
            {user.permissions.has("crm.view_all") ? "All leads in the organization." : "Leads assigned to or created by you."}
          </p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search name, company, email, phone" className="input w-72" aria-label="Search leads" />
          <button className="btn-ghost">Search</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        {leads.length === 0 ? (
          <p className="text-sm text-muted">No leads yet. Add your first lead below.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 pr-4">#</th><th className="pr-4">Name</th><th className="pr-4">Company</th>
                <th className="pr-4">Stage</th><th className="pr-4">Value</th><th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-muted">L-{l.number}</td>
                  <td className="pr-4 font-medium"><Link className="hover:underline" href={`/leads/${l.id}`}>{l.name}</Link></td>
                  <td className="pr-4">{l.company}</td>
                  <td className="pr-4">{l.stage.name}</td>
                  <td className="pr-4">{l.dealValue ? formatMoney(l.dealValue, l.currency) : ""}</td>
                  <td>{l.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <form action={createLead} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add lead</h2>
          {error && (
            <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>
          )}
          {[
            ["name", "Name", true], ["company", "Company", false], ["email", "Email", false], ["phone", "Phone", false],
            ["country", "Country", false], ["source", "Source (e.g. Facebook, referral)", false],
            ["serviceInterest", "Service interest", false], ["dealValue", "Expected deal value", false],
          ].map(([n, label, req]) => (
            <div key={String(n)}>
              <label className="label" htmlFor={String(n)}>{String(label)}</label>
              <input id={String(n)} name={String(n)} required={Boolean(req)} className="input" />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="input" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          {dup && (
            <label className="sm:col-span-2 text-sm flex items-center gap-2">
              <input type="checkbox" name="confirmDuplicate" value="1" /> Create anyway, I have checked the existing lead
            </label>
          )}
          <div className="sm:col-span-2"><button className="btn">Add lead</button></div>
        </form>
      )}
    </div>
  );
}
