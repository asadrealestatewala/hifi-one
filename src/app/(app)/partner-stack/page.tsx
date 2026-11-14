import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { APPLICATION_STATUSES, PROFESSION_LABEL, durationLabel, ensurePartnerDefaults, partnerId, typeLabel } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Chips, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import Drawer from "@/components/ui/Drawer";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { approveApplicationAction, rejectApplicationAction } from "./actions";
import { DurationFields } from "./_components/Fields";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; open?: string; saved?: string; error?: string };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Partner Stack: applications from the public Hifi Partner Stack page. Approving sets the partner's terms and issues certificates.
export default async function PartnerApplications({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  await ensurePartnerDefaults(db, org);
  const q = sp.q?.trim();
  const status = (APPLICATION_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const where: Prisma.PartnerApplicationWhereInput = {
    organizationId: org, ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { city: { contains: q, mode: "insensitive" } }, { country: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, byStatus, open, types, solutions] = await Promise.all([
    db.partnerApplication.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.partnerApplication.count({ where }),
    db.partnerApplication.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    sp.open ? db.partnerApplication.findFirst({ where: { id: sp.open, organizationId: org } }) : null,
    db.earnerType.findMany({ where: { organizationId: org, active: true, key: { not: "SALES_AGENT" } }, orderBy: { sortOrder: "asc" } }),
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const approvedAs = open?.earnerId ? await db.earner.findFirst({ where: { id: open.earnerId, organizationId: org }, select: { partnerNumber: true } }) : null;
  const decider = open?.decidedById ? await db.user.findFirst({ where: { id: open.decidedById, organizationId: org }, select: { name: true } }) : null;
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const all = byStatus.reduce((n, s) => n + s._count, 0);
  const current = { q, status };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/partner-stack${t ? `?${t}` : ""}`; };
  const wanted = open ? (types.find((t) => t.key === open.typeKey) ?? types.find((t) => t.key === "REFERRAL") ?? types[0]) : null;

  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack" />} title="Partner Stack" subtitle={<>Applications from the public <a className="underline" href="/partners" target="_blank" rel="noopener">Hifi Partner Stack</a> page.</>} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, email, phone or city" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined, page: undefined }) }, ...APPLICATION_STATUSES.map((s) => ({ key: s, label: label(s), count: count.get(s) ?? 0, href: href({ status: s, page: undefined }) }))]} />
      </div>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No applications yet" : "No applications match these filters"}>
          {all === 0 ? "When someone applies on the Hifi Partner Stack page, the application appears here and the Partner Managers are notified." : <Link className="underline" href="/partner-stack">Clear filters</Link>}
        </Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Applicant</th><th className="pr-4">Applying as</th><th className="pr-4">Where</th><th className="pr-4">Received</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5"><Link className="font-medium hover:underline" href={href({ open: a.id })}>{a.name}</Link><br /><span className="text-muted">{a.email}</span></td>
                  <td className="pr-4">{typeLabel(a.typeKey)}</td>
                  <td className="pr-4">{a.city}, {a.country}</td>
                  <td className="pr-4 whitespace-nowrap">{when(a.createdAt)}</td>
                  <td className="pr-4"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}
      {open && wanted && (
        <Drawer title={open.name} closeTo={href({})}>
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.saved && <Notice kind="ok">{sp.saved === "1" ? "Saved." : sp.saved}</Notice>}
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Email</dt><dd><a className="underline" href={`mailto:${open.email}`}>{open.email}</a></dd>
              <dt className="text-muted">Phone / WhatsApp</dt><dd><a className="underline" href={`tel:${open.phone}`}>{open.phone}</a></dd>
              <dt className="text-muted">Where</dt><dd>{open.city}, {open.country}</dd>
              <dt className="text-muted">Profession</dt>
              <dd>{PROFESSION_LABEL[open.professionKind] ?? open.professionKind}{open.company ? `: ${open.jobTitle} at ${open.company}` : ""}{open.professionOther ? `: ${open.professionOther}` : ""}</dd>
              <dt className="text-muted">Applying as</dt><dd>{typeLabel(open.typeKey)}</dd>
              <dt className="text-muted">Solutions</dt><dd>{open.solutionCodes.map((c) => solutions.find((x) => x.code === c)?.name ?? c).join(", ")}</dd>
              <dt className="text-muted">Sales experience</dt><dd className="whitespace-pre-wrap">{open.salesExperience ?? <span className="text-muted">None given</span>}</dd>
              <dt className="text-muted">Network</dt><dd>{open.networkSize ?? <span className="text-muted">None given</span>}</dd>
              <dt className="text-muted">Terms accepted</dt><dd>{when(open.termsAcceptedAt)}</dd>
              <dt className="text-muted">Received</dt><dd>{when(open.createdAt)}{open.submissions > 1 && ` · sent ${open.submissions} times, details are from the latest`}</dd>
              {open.status !== "NEW" && <><dt className="text-muted">Decision</dt><dd><StatusBadge status={open.status} /> {decider?.name} {open.decidedAt && when(open.decidedAt)}{open.decisionNote && <><br />{open.decisionNote}</>}</dd></>}
              {approvedAs && <><dt className="text-muted">Partner ID</dt><dd><Link className="font-medium underline" href={`/partner-stack/partners?open=${open.earnerId}`}>{partnerId(approvedAs.partnerNumber)}</Link></dd></>}
            </dl>
            {open.status === "NEW" && (
              <>
                <form action={approveApplicationAction} className="card space-y-3">
                  <h3 className="font-semibold">Approve</h3>
                  <p className="text-xs text-muted">Creates the partner, emails a link to set their password, and issues a certificate for each Solution you tick. Everything below can be changed later.</p>
                  <input type="hidden" name="id" value={open.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="ap-type">Partner type</label>
                      <select id="ap-type" name="typeKey" defaultValue={wanted.key} className="input">{types.map((t) => <option key={t.key} value={t.key}>{t.name} (default {Number(t.defaultRate)}%, {durationLabel(t.defaultDurationMonths).split(" (")[0]})</option>)}</select></div>
                    <div><label className="label" htmlFor="ap-rate">Commission %</label><input id="ap-rate" name="ratePercent" required inputMode="decimal" defaultValue={String(Number(wanted.defaultRate))} className="input" /></div>
                  </div>
                  <DurationFields idPrefix="ap" months={wanted.defaultDurationMonths} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="ap-terr">Territory</label><input id="ap-terr" name="territory" maxLength={200} className="input" placeholder="For example Lahore, Pakistan" /></div>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="leadSharing" defaultChecked={wanted.leadSharing} /> Share Hifi leads in their territory</label>
                  </div>
                  <fieldset className="space-y-1">
                    <legend className="label">Solutions and certificates</legend>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
                      <span className="text-xs text-muted">Solution</span><span className="text-xs text-muted">May sell</span><span className="text-xs text-muted">Certify now</span>
                      {solutions.map((s) => (
                        <div key={s.code} className="contents">
                          <span>{s.name}{open.solutionCodes.includes(s.code) && <span className="ml-2 text-xs text-muted">asked for</span>}</span>
                          <input type="checkbox" name={`sell_${s.code}`} defaultChecked={open.solutionCodes.includes(s.code)} aria-label={`May sell ${s.name}`} />
                          <input type="checkbox" name={`cert_${s.code}`} defaultChecked={open.solutionCodes.includes(s.code)} aria-label={`Certify for ${s.name}`} />
                        </div>
                      ))}
                    </div>
                  </fieldset>
                  <SubmitButton>Approve and certify</SubmitButton>
                </form>
                <form action={rejectApplicationAction} className="card space-y-3">
                  <h3 className="font-semibold">Reject</h3>
                  <input type="hidden" name="id" value={open.id} />
                  <p className="text-xs text-muted">The applicant is emailed your reason and can apply again later.</p>
                  <ConfirmButton className="btn-ghost" reason title="Reject this application?" message={`${open.name} will be emailed your reason.`} confirmLabel="Reject application">Reject</ConfirmButton>
                </form>
              </>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
