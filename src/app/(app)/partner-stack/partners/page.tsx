import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { certificateKindLabel, certificateStatus, durationLabel, parsePartnerId, partnerId } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Chips, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import Drawer from "@/components/ui/Drawer";
import SubmitButton from "@/components/ui/SubmitButton";
import { issueCertificateAction, updatePartnerAction } from "../actions";
import { DurationFields } from "../_components/Fields";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; open?: string; saved?: string; error?: string };
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Approved partners and the terms each one earns on. Every term here is per person and can be changed at any time.
export default async function Partners({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const status = ["ACTIVE", "SUSPENDED"].includes(sp.status ?? "") ? sp.status : undefined;
  const byNumber = q ? parsePartnerId(q) : null;
  const where: Prisma.EarnerWhereInput = {
    organizationId: org, ...(status ? { status } : {}),
    ...(q ? { OR: [...(byNumber ? [{ partnerNumber: byNumber }] : []), { name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { referralCode: { contains: q, mode: "insensitive" } }, { territory: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, byStatus, open, types, solutions] = await Promise.all([
    db.earner.findMany({ where, include: { type: true, solutions: { include: { product: { select: { name: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.earner.count({ where }),
    db.earner.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    sp.open ? db.earner.findFirst({ where: { id: sp.open, organizationId: org }, include: { type: true, solutions: { include: { product: true } }, certificates: { include: { product: { select: { name: true } } }, orderBy: [{ productId: "asc" }, { issuedAt: "desc" }] } } }) : null,
    db.earnerType.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const all = byStatus.reduce((n, s) => n + s._count, 0);
  const current = { q, status };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/partner-stack/partners${t ? `?${t}` : ""}`; };
  const now = new Date();
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/partners" />} title="Partner Stack" subtitle="Approved partners and the terms each one earns on." />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search Partner ID, name, email, territory or referral code" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined, page: undefined }) }, { key: "ACTIVE", label: "Active", count: count.get("ACTIVE") ?? 0, href: href({ status: "ACTIVE", page: undefined }) }, { key: "SUSPENDED", label: "Suspended", count: count.get("SUSPENDED") ?? 0, href: href({ status: "SUSPENDED", page: undefined }) }]} />
      </div>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No partners yet" : "No partners match these filters"}>{all === 0 ? <>Approve an application to create the first partner. <Link className="underline" href="/partner-stack">Open applications</Link></> : <Link className="underline" href="/partner-stack/partners">Clear filters</Link>}</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Partner ID</th><th className="pr-4">Partner</th><th className="pr-4">Type</th><th className="pr-4">Commission</th><th className="pr-4">Solutions</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">{partnerId(e.partnerNumber)}</td>
                  <td className="pr-4 py-2.5"><Link className="font-medium hover:underline" href={href({ open: e.id })}>{e.name}</Link><br /><span className="text-muted">{e.email}</span></td>
                  <td className="pr-4">{e.type.name}</td>
                  <td className="pr-4 whitespace-nowrap">{Number(e.ratePercent)}% · {durationLabel(e.durationMonths).split(" (")[0]}</td>
                  <td className="pr-4">{e.solutions.map((s) => s.product.name).join(", ")}</td>
                  <td className="pr-4"><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}
      {open && (
        <Drawer title={`${open.name} · ${partnerId(open.partnerNumber)}`} closeTo={href({})}>
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.saved && <Notice kind="ok">{sp.saved === "1" ? "Saved." : sp.saved}</Notice>}
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <p className="text-sm text-muted">{open.email}{open.phone && ` · ${open.phone}`}{open.city && ` · ${open.city}, ${open.country}`} · referral code <code>{open.referralCode}</code></p>
            <form action={updatePartnerAction} className="card space-y-3">
              <h3 className="font-semibold">Terms</h3>
              <input type="hidden" name="id" value={open.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="pt-type">Partner type</label><select id="pt-type" name="typeKey" defaultValue={open.type.key} className="input">{types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></div>
                <div><label className="label" htmlFor="pt-rate">Commission %</label><input id="pt-rate" name="ratePercent" required inputMode="decimal" defaultValue={String(Number(open.ratePercent))} className="input" /></div>
              </div>
              <DurationFields idPrefix="pt" months={open.durationMonths} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="pt-terr">Territory</label><input id="pt-terr" name="territory" maxLength={200} defaultValue={open.territory ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="pt-exp">Certificate validity (days)</label><input id="pt-exp" name="certExpiryDays" type="number" min={1} defaultValue={open.certExpiryDays ?? ""} className="input" placeholder="Default" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="leadSharing" defaultChecked={open.leadSharing} /> Share Hifi leads in their territory</label>
              <div><label className="label" htmlFor="pt-status">Status</label><select id="pt-status" name="status" defaultValue={open.status} className="input"><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended (cannot sign in)</option></select></div>
              <fieldset className="space-y-1"><legend className="label">Solutions they may sell</legend>
                <div className="grid gap-1 sm:grid-cols-2">{solutions.map((s) => <label key={s.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`sell_${s.code}`} defaultChecked={open.solutions.some((x) => x.productId === s.id)} /> {s.name}</label>)}</div></fieldset>
              <SubmitButton>Save terms</SubmitButton>
            </form>
            <section className="card space-y-3">
              <h3 className="font-semibold">Certificates</h3>
              {open.certificates.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {open.certificates.map((c) => { const st = certificateStatus(c, now); return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{c.product.name} · {certificateKindLabel(c.kind)} · <code>{c.publicId}</code></span><span className="text-muted">{st === "REVOKED" ? "revoked" : !c.expiresAt ? `completed ${when(c.issuedAt)}` : `${st === "EXPIRED" ? "expired" : "valid until"} ${when(c.expiresAt)}`}</span></li>
                  ); })}
                </ul>
              )}
              {open.status === "ACTIVE" && open.solutions.length > 0 && (
                <form action={issueCertificateAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={open.id} />
                  <div><label className="label" htmlFor="ic-kind">Certificate</label><select id="ic-kind" name="kind" className="input"><option value="TRAINING">Training certificate (training done)</option><option value="AUTHORISATION">Certificate of authorisation</option></select></div>
                  <div><label className="label" htmlFor="ic-sol">For</label><select id="ic-sol" name="solutionCode" className="input">{open.solutions.map((s) => <option key={s.productId} value={s.product.code}>{s.product.name}</option>)}</select></div>
                  <SubmitButton>Issue and email</SubmitButton>
                </form>
              )}
              {open.status === "ACTIVE" && open.solutions.length > 0 && (
                <p className="text-xs text-muted">Training comes first: issue the training certificate when the partner finishes training on a Solution, then the certificate of authorisation for that Solution.</p>
              )}
            </section>
          </div>
        </Drawer>
      )}
    </div>
  );
}
