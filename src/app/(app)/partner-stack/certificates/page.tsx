import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { certificateStatus } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Badge, Chips, Empty, Notice, PageHeader, Pager, SearchBox } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { renewCertificateAction, revokeCertificateAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; saved?: string; error?: string };
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATES = ["VALID", "EXPIRING", "EXPIRED", "REVOKED"] as const;

// Every certificate issued to a partner. Renewing keeps the ID, so a printed QR code stays valid; revoking is permanent and needs a reason.
export default async function Certificates({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const status = (STATES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const stateWhere: Prisma.PartnerCertificateWhereInput =
    status === "VALID" ? { status: "ACTIVE", expiresAt: { gt: now } } : status === "EXPIRING" ? { status: "ACTIVE", expiresAt: { gt: now, lte: soon } } : status === "EXPIRED" ? { status: "ACTIVE", expiresAt: { lte: now } } : status === "REVOKED" ? { status: "REVOKED" } : {};
  const where: Prisma.PartnerCertificateWhereInput = {
    organizationId: org, ...stateWhere,
    ...(q ? { OR: [{ publicId: { contains: q, mode: "insensitive" } }, { earner: { name: { contains: q, mode: "insensitive" } } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total] = await Promise.all([
    db.partnerCertificate.findMany({ where, include: { earner: { select: { name: true, email: true } }, product: { select: { name: true } } }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.partnerCertificate.count({ where }),
  ]);
  const all = await db.partnerCertificate.count({ where: { organizationId: org } });
  const current = { q, status };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/partner-stack/certificates${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/certificates" />} title="Partner Stack" subtitle="Certificates issued to partners. Anyone can check one at /partners/verify/<ID>." />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search partner, Solution or certificate ID" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", href: href({ status: undefined, page: undefined }) }, ...STATES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), href: href({ status: s, page: undefined }) }))]} />
      </div>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No certificates yet" : "No certificates match these filters"}>{all === 0 ? "Certificates are issued when you approve an application, or from a partner's page." : <Link className="underline" href="/partner-stack/certificates">Clear filters</Link>}</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Partner</th><th className="pr-4">Solution</th><th className="pr-4">Certificate ID</th><th className="pr-4">Expires</th><th className="pr-4">Status</th><th className="pr-4">Actions</th></tr></thead>
            <tbody className="divide-y divide-border align-top">
              {rows.map((c) => {
                const st = certificateStatus(c, now);
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5"><span className="font-medium">{c.earner.name}</span><br /><span className="text-muted">{c.earner.email}</span></td>
                    <td className="pr-4">{c.product.name}{c.renewals > 0 && <span className="block text-xs text-muted">renewed {c.renewals}×</span>}</td>
                    <td className="pr-4"><a className="underline" href={`/partners/verify/${c.publicId}`} target="_blank" rel="noopener">{c.publicId}</a></td>
                    <td className="pr-4 whitespace-nowrap">{when(c.expiresAt)}</td>
                    <td className="pr-4"><Badge tone={st === "VALID" ? "success" : "danger"}>{st.toLowerCase()}</Badge>{st === "REVOKED" && c.revokeReason && <span className="block text-xs text-muted">{c.revokeReason}</span>}</td>
                    <td className="pr-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <a className="underline" href={`/partner-stack/certificates/${c.id}/pdf`}>PDF</a>
                        {st !== "REVOKED" && (
                          <>
                            <form action={renewCertificateAction} className="flex items-center gap-1"><input type="hidden" name="id" value={c.id} /><input name="days" type="number" min={1} className="input !w-20 !py-1" placeholder="days" aria-label="Days of validity, empty for the default" /><SubmitButton>Renew</SubmitButton></form>
                            <form action={revokeCertificateAction}><input type="hidden" name="id" value={c.id} /><ConfirmButton reason title="Revoke this certificate?" message={<>{c.earner.name} will no longer be shown as authorised for {c.product.name}. This cannot be undone: issue a new certificate if needed.</>} confirmLabel="Revoke">Revoke</ConfirmButton></form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}
    </div>
  );
}
