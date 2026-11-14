import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { verifyCertificate } from "@/lib/partner-stack";
import { Icon } from "../../../_components/Icon";

export const dynamic = "force-dynamic";
// The page title and link-preview text name the partner only for a valid certificate; the preview image is opengraph-image.tsx.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await verifyCertificate(db, decodeURIComponent(id).toUpperCase());
  const title = c && c.status === "VALID" ? (c.kind === "TRAINING" ? `${c.partnerName}: ${c.solution} partner training` : `${c.partnerName}: authorised partner for ${c.solution}`) : "Verify a certificate";
  const description = c && c.status === "VALID" ? `Hifi Partner Stack certificate ${c.publicId}. Check that it is genuine and still valid.` : "Check whether a Hifi Partner Stack certificate is genuine and still valid.";
  return { title: { absolute: `${title} | Hifi Partner Stack` }, description, robots: { index: false, follow: false }, openGraph: { title, description, siteName: "Hifi Partner Stack", type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Anyone with a certificate id (from the QR code) can check it. Only the name, Solution, dates and status are shown.
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await verifyCertificate(db, decodeURIComponent(id).toUpperCase());
  return (
    <section className="hs-section">
      <div className="hs-container hs-narrow">
        <span className="hs-eyebrow">Hifi Partner Stack</span>
        <h1 className="hs-h2">Certificate check</h1>
        {!c ? (
          <div className="hs-card" role="status"><p className="hs-alert hs-alert-error">No certificate was found with this ID.</p><p style={{ marginTop: 12 }}>Check the ID printed on the certificate and try again. If it still does not match, treat the certificate as not genuine.</p></div>
        ) : (
          <div className="hs-card" role="status">
            <p className={c.status === "VALID" ? "hs-verify ok" : "hs-verify bad"}>
              <Icon name={c.status === "VALID" ? "check" : "close"} size={18} /> {c.status === "VALID" ? "Valid certificate" : c.status === "EXPIRED" ? "This certificate has expired" : "This certificate has been revoked"}
            </p>
            <dl className="hs-dl">
              <dt>Certificate</dt><dd>{c.kind === "TRAINING" ? "Partner training completed" : "Partner authorisation"}</dd>
              <dt>Partner</dt><dd>{c.partnerName}</dd>
              <dt>Partner ID</dt><dd>{c.partnerId}</dd>
              <dt>{c.kind === "TRAINING" ? "Trained on" : "Authorised for"}</dt><dd>{c.solution}</dd>
              <dt>{c.kind === "TRAINING" ? "Completed" : "Issued"}</dt><dd>{day(c.issuedAt)}</dd>
              {c.expiresAt && <><dt>{c.status === "EXPIRED" ? "Expired" : "Valid until"}</dt><dd>{day(c.expiresAt)}</dd></>}
              <dt>Certificate ID</dt><dd>{c.publicId}</dd>
            </dl>
          </div>
        )}
        <p className="hs-hint" style={{ marginTop: 16 }}><Link href="/partners">About Hifi Partner Stack</Link></p>
      </div>
    </section>
  );
}
