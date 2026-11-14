import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { certificateKindLabel, certificateStatus, durationLabel, getSettings, linkedInAddUrl, linkedInShareUrl, partnerId } from "@/lib/partner-stack";
import { Badge, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Phase 1 home: the partner's own terms, Solutions and certificates. Leads, clients and commissions arrive in later phases.
export default async function PartnerHome() {
  const { user, earner } = await requirePartnerUser();
  const [type, solutions, certs, settings, org] = await Promise.all([
    db.earnerType.findUniqueOrThrow({ where: { id: earner.typeId } }),
    db.earnerSolution.findMany({ where: { earnerId: earner.id }, include: { product: { select: { name: true } } } }),
    db.partnerCertificate.findMany({ where: { earnerId: earner.id }, include: { product: { select: { name: true } } }, orderBy: [{ productId: "asc" }, { issuedAt: "asc" }] }),
    getSettings(db, user.organizationId),
    db.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } }),
  ]);
  const company = org?.name ?? "Hifi Marketing and Technologies";
  const now = new Date();
  return (
    <>
      <PageHeader title={`Welcome, ${earner.name.split(" ")[0]}`} subtitle="Your Hifi Partner Stack terms and certificates." />
      <section className="card space-y-3">
        <h2 className="font-semibold">Your terms</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Partner ID</dt><dd className="font-semibold">{partnerId(earner.partnerNumber)}</dd>
          <dt className="text-muted">Partner type</dt><dd>{type.name}</dd>
          <dt className="text-muted">Commission</dt><dd>{Number(earner.ratePercent)}% recurring</dd>
          <dt className="text-muted">Duration</dt><dd>{durationLabel(earner.durationMonths)}</dd>
          <dt className="text-muted">Territory</dt><dd>{earner.territory ?? <span className="text-muted">Not set</span>}</dd>
          <dt className="text-muted">Hifi leads</dt><dd>{earner.leadSharing ? "You receive leads in your territory" : "You bring your own leads"}</dd>
          <dt className="text-muted">Solutions</dt><dd>{solutions.map((s) => s.product.name).join(", ")}</dd>
          <dt className="text-muted">Referral code</dt><dd><code>{earner.referralCode}</code></dd>
        </dl>
      </section>
      <section className="card !p-0 overflow-hidden">
        <h2 className="px-4 pt-4 font-semibold">Your certificates</h2>
        {certs.length === 0 ? (
          <div className="p-4"><Empty title="No certificates yet">The partner team issues a certificate for each Solution you may sell.</Empty></div>
        ) : (
          <div className="overflow-x-auto"><table className="mt-2 w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Solution</th><th className="pr-4">Type</th><th className="pr-4">Certificate ID</th><th className="pr-4">Valid until</th><th className="pr-4">Status</th><th className="pr-4"><span className="sr-only">Download and share</span></th></tr></thead>
            <tbody className="divide-y divide-border">
              {certs.map((c) => {
                const st = certificateStatus(c, now);
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-medium">{c.product.name}</td>
                    <td className="pr-4 whitespace-nowrap">{certificateKindLabel(c.kind)}</td>
                    <td className="pr-4"><a className="underline" href={`/partners/verify/${c.publicId}`} target="_blank" rel="noopener">{c.publicId}</a></td>
                    <td className="pr-4 whitespace-nowrap">{c.expiresAt ? day(c.expiresAt) : "Does not expire"}</td>
                    <td className="pr-4"><Badge tone={st === "VALID" ? "success" : "danger"}>{st.toLowerCase()}</Badge></td>
                    <td className="pr-4 py-2.5">
                      {st === "VALID" && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:text-sm">
                          <a className="underline" href={`/partner/certificates/${c.id}/pdf`}>Download PDF</a>
                          <a className="underline" href={`/partner/certificates/${c.id}/image`}>Download image</a>
                          <a className="underline" href={linkedInAddUrl({ kind: c.kind, solutionName: c.product.name, company, issuedAt: c.issuedAt, publicId: c.publicId, linkedInCompanyId: settings.linkedin_company_id })} target="_blank" rel="noopener noreferrer">Add to LinkedIn profile</a>
                          <a className="underline" href={linkedInShareUrl(c.publicId)} target="_blank" rel="noopener noreferrer">Share on LinkedIn</a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="px-4 pt-4 text-xs text-muted">Adding to your LinkedIn profile fills in the certificate name, issuer, ID and verify link for you. Sharing posts your verify link, which shows the certificate as a picture; the image download is for Facebook, Instagram, WhatsApp or anywhere else.</p>
        <p className="p-4 text-xs text-muted">You get a training certificate when you finish training on a Solution, then the certificate of authorisation that lets you sell it. A certificate of authorisation that is about to expire is renewed by the partner team. We email you 7 days and 1 day before.</p>
      </section>
    </>
  );
}
