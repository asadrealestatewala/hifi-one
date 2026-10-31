import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHero } from "../../_components/Blocks";
import { ContactForm } from "../../_components/ContactForm";
import { Icon } from "../../_components/Icon";
import { EMAIL, OFFICES, PHONE, PHONE_HREF, SOCIALS } from "../../_content/site";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Get a quote or ask a question. Email careers.asia@hifimarketing.co, call +92 316 8080801, or send us a message. Offices in Pakistan, the UAE, the UK and the US.",
  alternates: { canonical: "/site/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Get in touch" intro="Tell us about your project. We usually reply within one working day." />
      <section className="hs-section">
        <div className="hs-container hs-contact-grid">
          <div>
            <h2 style={{ fontSize: 24, margin: "0 0 18px" }}>Talk to us</h2>
            <ul className="hs-contact-list">
              <li><a href={`mailto:${EMAIL}`}><span className="hs-ic"><Icon name="mail" size={20} /></span><span><span className="hs-sr">Email: </span>{EMAIL}</span></a></li>
              <li><a href={PHONE_HREF}><span className="hs-ic"><Icon name="phone" size={20} /></span><span><span className="hs-sr">Phone: </span>{PHONE}</span></a></li>
            </ul>
            <h2 style={{ fontSize: 24, margin: "40px 0 0" }}>Our offices</h2>
            <div className="hs-offices">
              {OFFICES.map((o) => (
                <div key={o.region} className="hs-office">
                  <h3><Icon name="pin" size={16} /> {o.region} <span className="hs-kind">&middot; {o.kind}</span></h3>
                  {o.lines.map((l) => <p key={l}>{l}</p>)}
                </div>
              ))}
            </div>
            <h2 style={{ fontSize: 24, margin: "40px 0 14px" }}>Follow us</h2>
            <ul className="hs-socials" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {SOCIALS.map((s) => <li key={s.href}><a href={s.href} aria-label={s.label} rel="noopener" target="_blank"><Icon name={s.icon} size={18} /></a></li>)}
            </ul>
          </div>
          <div className="hs-card" style={{ padding: 32 }}>
            <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>Send us a message</h2>
            <p className="hs-muted" style={{ margin: "0 0 22px" }}>All fields are required unless marked optional.</p>
            <Suspense fallback={null}>
              <ContactForm />
            </Suspense>
          </div>
        </div>
      </section>
    </>
  );
}
