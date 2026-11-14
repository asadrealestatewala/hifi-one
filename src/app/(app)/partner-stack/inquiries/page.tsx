import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { INQUIRY_STATUSES, typeLabel } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Chips, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import Drawer from "@/components/ui/Drawer";
import SubmitButton from "@/components/ui/SubmitButton";
import { updateInquiryAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; open?: string; saved?: string; error?: string };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Questions asked on the public Hifi Partner Stack page. Each gets an automatic reply; the team answers by email.
export default async function PartnerInquiries({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const status = (INQUIRY_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const where: Prisma.PartnerInquiryWhereInput = {
    organizationId: org, ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { message: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, byStatus, open] = await Promise.all([
    db.partnerInquiry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.partnerInquiry.count({ where }),
    db.partnerInquiry.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    sp.open ? db.partnerInquiry.findFirst({ where: { id: sp.open, organizationId: org } }) : null,
  ]);
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const all = byStatus.reduce((n, s) => n + s._count, 0);
  const current = { q, status };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/partner-stack/inquiries${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/inquiries" />} title="Partner Stack" subtitle="Questions from the public Hifi Partner Stack page. Reply by email, then mark them replied." />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, email or question" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined, page: undefined }) }, ...INQUIRY_STATUSES.map((s) => ({ key: s, label: label(s), count: count.get(s) ?? 0, href: href({ status: s, page: undefined }) }))]} />
      </div>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No questions yet" : "No questions match these filters"}>{all === 0 ? "Questions from the Ask a Question form appear here." : <Link className="underline" href="/partner-stack/inquiries">Clear filters</Link>}</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">From</th><th className="pr-4">Question</th><th className="pr-4">Interested in</th><th className="pr-4">Received</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5"><Link className="font-medium hover:underline" href={href({ open: r.id })}>{r.name}</Link><br /><span className="text-muted">{r.email}</span></td>
                  <td className="pr-4 max-w-xs truncate">{r.message}</td>
                  <td className="pr-4">{r.interestedType ? typeLabel(r.interestedType) : ""}</td>
                  <td className="pr-4 whitespace-nowrap">{when(r.createdAt)}</td>
                  <td className="pr-4"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}
      {open && (
        <Drawer title={open.name} closeTo={href({})}>
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.saved && <Notice kind="ok">{sp.saved === "1" ? "Saved." : sp.saved}</Notice>}
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Email</dt><dd><a className="underline" href={`mailto:${open.email}`}>{open.email}</a></dd>
              <dt className="text-muted">Phone</dt><dd>{open.phone ? <a className="underline" href={`tel:${open.phone}`}>{open.phone}</a> : "—"}</dd>
              <dt className="text-muted">Where</dt><dd>{[open.city, open.country].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="text-muted">Profession</dt><dd>{open.profession ?? "—"}</dd>
              <dt className="text-muted">Interested in</dt><dd>{open.interestedType ? typeLabel(open.interestedType) : "—"}</dd>
              <dt className="text-muted">Received</dt><dd>{when(open.createdAt)}</dd>
            </dl>
            <section><h3 className="mb-1 text-sm font-semibold">Question</h3><p className="whitespace-pre-wrap text-sm">{open.message}</p></section>
            <form action={updateInquiryAction} className="card space-y-3">
              <input type="hidden" name="id" value={open.id} />
              <div><label className="label" htmlFor="iq-status">Status</label><select id="iq-status" name="status" defaultValue={open.status} className="input">{INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
              <div><label className="label" htmlFor="iq-note">Internal note (never shown to them)</label><textarea id="iq-note" name="note" defaultValue={open.note ?? ""} rows={4} maxLength={2000} className="input" /></div>
              <SubmitButton>Save</SubmitButton>
            </form>
          </div>
        </Drawer>
      )}
    </div>
  );
}
