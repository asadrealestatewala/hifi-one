import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DUP_MODES, DUP_MODE_LABEL, getPolicy, scanLeadDuplicates } from "@/lib/lead-duplicates";
import { CALLING_CODES, countryName } from "@/lib/phone";
import { Badge, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { protectExistingLeads, saveDuplicatePolicy } from "./actions";

export const dynamic = "force-dynamic";
const MODE_HELP = {
  BLOCK: "Nobody can add a lead whose phone or email is already on another lead, in any status. They are shown the existing lead instead.",
  WARN: "The agent is warned and may confirm that it is a different person. Confirmed duplicates are recorded in the audit log.",
  OFF: "Duplicates are not checked. Website forms still add a repeat visitor to their open lead as a note.",
} as const;
const SHOWN = 100;

export default async function Duplicates({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; scan?: string }> }) {
  const user = await requirePermission("crm.duplicates");
  const sp = await searchParams;
  const policy = await getPolicy(db, user.organizationId);
  const report = sp.scan ? await scanLeadDuplicates(db, user.organizationId) : null;
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Duplicate leads" subtitle="One person, one lead. Phone numbers are compared in international form and emails in lower case. A lead that is Not interested or lost still counts. Only a Super Admin can open this page." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={saveDuplicatePolicy} className="card space-y-4">
        <fieldset className="space-y-2">
          <legend className="font-semibold">When a lead&apos;s phone or email already exists</legend>
          {DUP_MODES.map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm"><input type="radio" name="mode" value={m} defaultChecked={policy.mode === m} className="mt-1" />
              <span><strong>{DUP_MODE_LABEL[m]}{m === "BLOCK" && " (recommended)"}.</strong> <span className="text-muted">{MODE_HELP[m]}</span></span></label>
          ))}
        </fieldset>
        <div className="max-w-xs"><label className="label" htmlFor="defaultCountry">Country for numbers typed without a country code</label>
          <select id="defaultCountry" name="defaultCountry" className="input" defaultValue={policy.defaultCountry}>
            {Object.keys(CALLING_CODES).map((c) => <option key={c} value={c}>{countryName(c)} (+{CALLING_CODES[c]})</option>)}
          </select></div>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>

      <section className="card space-y-3" aria-label="Existing duplicates">
        <h2 className="font-semibold">Existing duplicates</h2>
        <p className="text-sm text-muted">The scan lists leads that already share a phone or email. It changes nothing: nothing is deleted or merged, so decide each group yourself (keep the oldest lead and move the notes, or reassign). Then record the claims so the database itself refuses new duplicates.</p>
        <div className="flex flex-wrap gap-3">
          <Link className="btn-ghost" href="/settings/duplicates?scan=1">Scan existing leads</Link>
          <form action={protectExistingLeads}><SubmitButton pendingText="Recording…">Record phone and email claims</SubmitButton></form>
        </div>
        {report && (report.groups.length === 0
          ? <Notice kind="ok">{report.total} leads scanned. No two leads share a phone or email.</Notice>
          : (
            <>
              <p className="text-sm">{report.total} leads scanned. <strong>{report.groups.length}</strong> shared {report.groups.length === 1 ? "value" : "values"} found{report.groups.length > SHOWN && `, the first ${SHOWN} shown`}.</p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Shared</th><th className="pr-4">Leads (oldest first)</th></tr></thead>
                <tbody>{report.groups.slice(0, SHOWN).map((g) => (
                  <tr key={g.kind + g.key} className="border-t border-border align-top">
                    <td className="py-2 pr-4"><Badge tone="neutral">{g.kind === "EMAIL" ? "email" : "phone"}</Badge> <span className="break-all">{g.key}</span></td>
                    <td className="py-2 pr-4"><ul className="space-y-1">{g.leads.map((l) => (
                      <li key={l.id}><Link className="font-medium hover:underline" href={`/leads/${l.id}`}>{l.name} (L-{l.number})</Link> <span className="text-muted">{l.stageName}, {l.ownerName ?? "unassigned"}, added {l.createdAt.toLocaleDateString("en-GB")}</span></li>
                    ))}</ul></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          ))}
      </section>
    </div>
  );
}
