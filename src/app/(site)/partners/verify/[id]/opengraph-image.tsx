import { db } from "@/lib/db";
import { socialCardFor } from "@/lib/partner-stack";
import { SOCIAL_SIZE, socialCertificateImage } from "@/lib/partner-social-image";

export const dynamic = "force-dynamic";
export const size = SOCIAL_SIZE;
export const contentType = "image/png";
export const alt = "Hifi Partner Stack certificate";

// The preview card LinkedIn, WhatsApp and X show when a verify link is shared. Only a valid certificate shows the partner's details.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await socialCardFor(db, decodeURIComponent(id).toUpperCase());
  return socialCertificateImage(card);
}
