import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { samplePartnerCertificate } from "@/lib/partner-stack";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A sample training or certificate of authorisation with example details and the saved signatory, linked from settings.
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await requirePermission("partners.settings");
  const { kind } = await params;
  const pdf = await samplePartnerCertificate(db, user.organizationId, kind.toUpperCase());
  if (!pdf) return notFound();
  return pdfResponse(pdf, `Hifi-Partner-Stack-sample-${kind.toLowerCase()}`);
}
