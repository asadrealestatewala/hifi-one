import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "../../_components/Blocks";
import { COMPANY, PHONE, PHONE_HREF } from "../../_content/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${COMPANY} handles the information you send through this website and the social media accounts our clients connect for publishing.`,
  alternates: { canonical: "/site/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy policy" intro="Last updated 17 November 2026" />
      <section className="hs-section">
        <div className="hs-container hs-prose" style={{ maxWidth: 760 }}>
          <h2>Who we are</h2>
          <p>{COMPANY} (&ldquo;we&rdquo;) runs this website and Hifi One, the software our team uses to plan, approve and publish our clients&rsquo; social media content.</p>

          <h2>What we collect on this website</h2>
          <p>When you send the contact, quote, partner or job application forms, we receive what you type in them (such as your name, email address, phone number, company and message) and any file you attach. We use it only to answer you or to consider your application. We do not sell it.</p>

          <h2>Facebook and Instagram accounts our clients connect</h2>
          <p>A client, or someone who manages their Facebook Page, can connect the Page and its linked Instagram professional account to Hifi One by signing in with Facebook. From Meta we then receive:</p>
          <ul>
            <li>the names and IDs of the Pages they chose to share, and the linked Instagram account&rsquo;s ID, name and username;</li>
            <li>an access token for each Page, which lets us publish to it.</li>
          </ul>
          <p>We use this only to publish posts that the client has approved in Hifi One, to add the first comment they wrote, and to read back the link to each published post so the client can see it. We do not read messages, followers&rsquo; personal information or ads data, and we do not post anything the client has not approved.</p>
          <p>Access tokens are stored encrypted, are never shown to anyone, and are deleted when the account is disconnected.</p>

          <h2>Who can see it</h2>
          <p>Only our staff who manage the client&rsquo;s content, and the client&rsquo;s own users in their Hifi One portal. We share data with service providers only as needed to run the service (hosting, email delivery) and with Meta when we publish on the client&rsquo;s behalf.</p>

          <h2>How long we keep it</h2>
          <p>Form messages are kept while we deal with your enquiry and for our business records. Connected account details are kept while the client uses our publishing service and are deleted when the account is disconnected or on request.</p>

          <h2>Your choices</h2>
          <p>You can ask us to see, correct or delete information about you. To remove a connected Facebook or Instagram account and its data, follow the steps on our <Link href="/site/data-deletion">data deletion page</Link>.</p>

          <h2>Contact</h2>
          <p>Write to us through the <Link href="/site/contact">contact page</Link> or call <a href={PHONE_HREF}>{PHONE}</a>.</p>
        </div>
      </section>
    </>
  );
}
