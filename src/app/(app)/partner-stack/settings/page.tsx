import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACADEMY_TEST_SETTINGS, SOLUTION_EXPIRY_KEY, ensurePartnerDefaults, getSettings } from "@/lib/partner-stack";
import { Notice, PageHeader } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import SubmitButton from "@/components/ui/SubmitButton";
import { saveSettingsAction } from "../actions";
import { CERTIFICATE_KINDS } from "@/lib/partner-certificate-pdf";

export const dynamic = "force-dynamic";

type SP = { saved?: string; error?: string };

// Every default of the programme. Nothing here is fixed in code: a new partner starts from these, and each partner can then differ.
export default async function PartnerSettings({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.settings");
  const sp = await searchParams;
  const org = user.organizationId;
  await ensurePartnerDefaults(db, org);
  const [types, solutions, s] = await Promise.all([
    db.earnerType.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getSettings(db, org),
  ]);
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/settings" />} title="Partner Stack" subtitle="Defaults for new partners. Changing them never changes partners who are already approved." />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={saveSettingsAction} className="space-y-5">
        <section className="card !p-0 overflow-x-auto">
          <h2 className="px-4 pt-4 font-semibold">Partner types</h2>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2">Type</th><th className="pr-3">Commission %</th><th className="pr-3">Months (empty = lifetime)</th><th className="pr-3">Hifi leads</th><th className="pr-3">On public page</th><th className="pr-3">Final test for authorisation</th><th className="pr-3">Active</th></tr></thead>
            <tbody className="divide-y divide-border">
              {types.map((t) => (
                <tr key={t.key}>
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="pr-3"><input name={`rate_${t.key}`} defaultValue={String(Number(t.defaultRate))} inputMode="decimal" className="input !w-20" aria-label={`${t.name} commission percent`} /></td>
                  <td className="pr-3"><input name={`months_${t.key}`} defaultValue={t.defaultDurationMonths ?? ""} type="number" min={1} max={600} className="input !w-24" aria-label={`${t.name} months`} /></td>
                  <td className="pr-3"><input type="checkbox" name={`lead_${t.key}`} defaultChecked={t.leadSharing} aria-label={`${t.name} receives Hifi leads`} /></td>
                  <td className="pr-3"><input type="checkbox" name={`public_${t.key}`} defaultChecked={t.publicOffer} aria-label={`${t.name} shown on the public page`} /></td>
                  <td className="pr-3"><input type="checkbox" name={`academyreq_${t.key}`} defaultChecked={t.academyRequired} aria-label={`${t.name} earns the certificate of authorisation through the Academy final test`} /></td>
                  <td className="pr-3"><input type="checkbox" name={`active_${t.key}`} defaultChecked={t.active} aria-label={`${t.name} active`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-4 text-xs text-muted">The Exclusive Sales Partner rate is set per person when you approve them; this is only the starting value. The Sales Agent type is used from Phase 5. &ldquo;Final test for authorisation&rdquo;: partners of that type get the certificate of authorisation by passing the Partner Academy final test; untick it (as for Exclusive partners) to issue it by hand. One partner can also be given direct access on their page.</p>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Partner Academy final and refresher tests</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(ACADEMY_TEST_SETTINGS).map(([key, [label, min, max]]) => (
              <div key={key}><label className="label" htmlFor={`s-${key}`}>{label}</label><input id={`s-${key}`} name={key} type="number" min={min} max={max} required defaultValue={s[key]} className="input" /></div>
            ))}
          </div>
          <p className="text-xs text-muted">Questions are drawn at random from every published question of the Solution&rsquo;s course. A test not submitted in time counts as a try. After the last try the test pauses and the partner team is told. Passing issues the certificate of authorisation automatically. The refresher test renews it: it uses the same pass mark and retake rules, opens the set number of days before the certificate expires, and keeps the certificate ID.</p>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Certificates</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label" htmlFor="s-exp">Certificate of authorisation validity (days), all Solutions</label><input id="s-exp" name="cert_expiry_days" type="number" min={1} defaultValue={s.cert_expiry_days} className="input" /></div>
            <div><label className="label" htmlFor="s-r1">First reminder (days before)</label><input id="s-r1" name="cert_first_reminder_days" type="number" min={1} defaultValue={s.cert_first_reminder_days} className="input" /></div>
            <div><label className="label" htmlFor="s-r2">Second reminder (days before)</label><input id="s-r2" name="cert_second_reminder_days" type="number" min={1} defaultValue={s.cert_second_reminder_days} className="input" /></div>
            <div><label className="label" htmlFor="s-r3">Final reminder (days before)</label><input id="s-r3" name="cert_final_reminder_days" type="number" min={1} defaultValue={s.cert_final_reminder_days} className="input" /></div>
          </div>
          <fieldset><legend className="label">Validity per Solution (days, empty = use the default above)</legend>
            <div className="grid gap-3 sm:grid-cols-3">{solutions.map((p) => <div key={p.code}><label className="label" htmlFor={`s-${p.code}`}>{p.name}</label><input id={`s-${p.code}`} name={SOLUTION_EXPIRY_KEY(p.code)} type="number" min={1} defaultValue={s[SOLUTION_EXPIRY_KEY(p.code)] ?? ""} className="input" /></div>)}</div></fieldset>
          <p className="text-xs text-muted">A single partner can have their own validity on their page. Order of use: the partner, then the Solution, then this default.</p>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Certificate types</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CERTIFICATE_KINDS.map((k) => (
              <li key={k.key} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{k.label} <span className="text-xs font-normal text-muted">({k.design})</span></p>
                <p className="mt-1 text-xs text-muted">{k.hint}</p>
                <a href={`/partner-stack/settings/preview/${k.key.toLowerCase()}`} target="_blank" rel="noopener" className="mt-2 inline-block text-xs text-primary underline">Open sample PDF</a>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="s-sn">Signed by (optional)</label><input id="s-sn" name="cert_signatory_name" defaultValue={s.cert_signatory_name} maxLength={80} className="input" placeholder="Full name" /></div>
            <div><label className="label" htmlFor="s-st">Their title (optional)</label><input id="s-st" name="cert_signatory_title" defaultValue={s.cert_signatory_title} maxLength={80} className="input" placeholder="e.g. Head of Partnerships" /></div>
          </div>
          <p className="text-xs text-muted">Leave the name empty to print the company name instead of a signature line.</p>
          <div className="max-w-sm"><label className="label" htmlFor="s-li">LinkedIn company page ID (optional)</label><input id="s-li" name="linkedin_company_id" defaultValue={s.linkedin_company_id} inputMode="numeric" maxLength={15} className="input" /></div>
          <p className="text-xs text-muted">The number in your LinkedIn company admin link (linkedin.com/company/<b>12345678</b>/admin). With it, LinkedIn shows your logo when partners add the certificate to their profile; without it, only the company name.</p>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Earnings calculator on the public page</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="s-cp">Example monthly price per client</label><input id="s-cp" name="calculator_price" defaultValue={s.calculator_price} inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="s-cc">Currency</label><input id="s-cc" name="calculator_currency" defaultValue={s.calculator_currency} maxLength={3} className="input" /></div>
          </div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Partner terms</h2>
          <p className="text-xs text-muted">Shown on the application form. Have your lawyer review the wording before you rely on it.</p>
          <label className="sr-only" htmlFor="s-terms">Partner terms</label>
          <textarea id="s-terms" name="terms_text" rows={14} defaultValue={s.terms_text} className="input font-mono text-xs" />
        </section>
        <SubmitButton>Save settings</SubmitButton>
      </form>
    </div>
  );
}
