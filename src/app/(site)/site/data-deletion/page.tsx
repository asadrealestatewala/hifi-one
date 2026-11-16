import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "../../_components/Blocks";
import { COMPANY, PHONE, PHONE_HREF } from "../../_content/site";

export const metadata: Metadata = {
  title: "Data deletion",
  description: `How to remove a Facebook Page or Instagram account connected to ${COMPANY} and delete its data.`,
  alternates: { canonical: "/site/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Deleting your data" intro="How to disconnect a Facebook Page or Instagram account from our publishing service and have its data deleted." />
      <section className="hs-section">
        <div className="hs-container hs-prose" style={{ maxWidth: 760 }}>
          <h2>Remove our access on Facebook</h2>
          <ol>
            <li>On Facebook, open Settings &amp; privacy → Settings.</li>
            <li>Open Business integrations (under Permissions).</li>
            <li>Find our app, tick it and press Remove.</li>
          </ol>
          <p>From that moment we can no longer publish to your Page or Instagram account.</p>

          <h2>Ask us to delete what we stored</h2>
          <p>Send us a request through the <Link href="/site/contact">contact page</Link> or call <a href={PHONE_HREF}>{PHONE}</a>, naming the Page or Instagram account. Within 30 days we disconnect it, delete its access token and account details, and confirm to you when it is done. Your own account manager can also disconnect it for you straight away.</p>

          <h2>What is deleted</h2>
          <p>The Page and Instagram account names, IDs, usernames and access tokens we received from Meta. Posts already published on Facebook or Instagram stay there; you can remove them on Facebook or Instagram yourself.</p>
          <p>See our <Link href="/site/privacy">privacy policy</Link> for more.</p>
        </div>
      </section>
    </>
  );
}
