import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { socialCardFor } from "@/lib/partner-stack";
import { socialCertificateImage } from "@/lib/partner-social-image";
import { notFound } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A partner downloads the image version of their own valid certificate, to post on LinkedIn or other social media.
// The earner comes from the session, so another partner's id finds nothing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, earner } = await requirePartnerUser();
  const { id } = await params;
  const cert = await db.partnerCertificate.findFirst({ where: { id, organizationId: user.organizationId, earnerId: earner.id }, select: { publicId: true } });
  if (!cert) return notFound();
  const card = await socialCardFor(db, cert.publicId);
  if (!card || card.status !== "VALID") return notFound();
  return socialCertificateImage(card, {
    headers: { "Content-Disposition": `attachment; filename="Hifi-Partner-Stack-${card.publicId}.png"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
