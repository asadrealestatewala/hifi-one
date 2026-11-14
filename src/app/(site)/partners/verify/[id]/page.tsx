import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { verifyCertificate } from "@/lib/partner-stack";
import { Icon } from "../../../_components/Icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Verify a certificate | Hifi Partner Stack" }, robots: { index: false, follow: false } };

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
              <dt>Partner</dt><dd>{c.partnerName}</dd>
              <dt>Authorised for</dt><dd>{c.solution}</dd>
              <dt>Issued</dt><dd>{day(c.issuedAt)}</dd>
              <dt>{c.status === "EXPIRED" ? "Expired" : "Valid until"}</dt><dd>{day(c.expiresAt)}</dd>
              <dt>Certificate ID</dt><dd>{c.publicId}</dd>
            </dl>
          </div>
        )}
        <p className="hs-hint" style={{ marginTop: 16 }}><Link href="/partners">About Hifi Partner Stack</Link></p>
      </div>
    </section>
  );
}
