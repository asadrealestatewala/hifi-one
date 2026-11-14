import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { durationLabel, publicProgramme } from "@/lib/partner-stack";
import { websiteOrganizationId } from "@/lib/site-forms";
import { Icon } from "../_components/Icon";
import { SectionHead } from "../_components/Blocks";
import { Calculator } from "./_components/Calculator";
import { ApplicationForm, InquiryForm } from "./_components/PartnerForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Hifi Partner Stack" },
  description: "Earn recurring commission selling AI-powered ERPs for real estate, automobile, pharmacy and schools. Apply to become a Hifi referral, reseller or exclusive sales partner.",
  alternates: { canonical: "/partners" },
};

const STEPS = [
  ["Apply", "Tell us who you are and what you want to sell."],
  ["Approved", "Our team reviews your application and sets your terms."],
  ["Certified", "You receive a certificate for each Solution you are approved to sell."],
  ["Sell", "Share your referral link, or demo and close clients yourself."],
  ["Earn", "Commission is paid on every payment your clients make."],
];
const WHO = ["University students", "Employees", "Business owners", "Freelancers", "Industry professionals"];

export default async function PartnersPage() {
  const org = await websiteOrganizationId(db);
  if (!org) notFound();
  const { types, solutions, settings } = await publicProgramme(db, org);
  const rates = types.map((t) => Number(t.defaultRate));
  const top = rates.length ? Math.max(...rates) : 30;
  const topLabel = Number.isInteger(top) ? String(top) : top.toFixed(1);
  const typeOptions = types.map((t) => ({ key: t.key, name: t.name }));
  const days = settings.cert_expiry_days;
  const faq: [string, string][] = [
    ["Is there a fee to join?", "No. Applying and becoming a partner is free."],
    ["How is my commission worked out?", "As a percentage of the money Hifi actually receives from the clients you are credited with, on every payment while your commission period runs. Refunds and cancellations reduce or stop it."],
    ["How long do I earn commission?", "It depends on your partner type and the terms we agree with you. The standard offer is lifetime: as long as the client keeps paying."],
    ["What is the certificate for?", `After approval you receive a certificate for each Solution you may sell, with a unique ID and QR code anyone can check. Certificates are valid for ${days} days by default and we remind you before they expire.`],
    ["Do I need sales experience?", "No. Students and first-time sellers are welcome. We show you how each Solution works."],
    ["Can I join while I have a job?", "Yes, as long as selling Hifi Solutions does not break your employer's rules. We ask for your company and job title when you apply."],
    ["When and how do I get paid?", "Commission is approved after a short hold and then paid out monthly with a statement. The payout screens are part of the partner portal."],
    ["Will Hifi send me leads?", "Exclusive Sales Partners receive Hifi leads in their territory. Referral and Reseller Partners bring their own."],
  ];
  return (
    <>
      <section className="hs-page-hero">
        <div className="hs-container">
          <span className="hs-eyebrow">Hifi Partner Stack</span>
          <h1>Earn up to {topLabel}% recurring commission selling AI-powered ERPs</h1>
          <p>Join as a referral, reseller or exclusive sales partner for Hifi&rsquo;s ERP Solutions for real estate, automobile, pharmacy and schools.</p>
          <div className="hs-actions" style={{ marginTop: 28 }}>
            <a className="hs-btn" href="#apply">Become a Partner <Icon name="arrow" size={16} /></a>
            <a className="hs-btn hs-btn-ghost" href="#ask">Ask a Question</a>
          </div>
        </div>
      </section>

      <section className="hs-section" id="solutions">
        <div className="hs-container">
          <SectionHead eyebrow="What you sell" title="Our AI-powered ERP Solutions" intro="One partner programme, every Solution." />
          <div className="hs-grid hs-grid-4">
            {solutions.map((s) => (
              <div key={s.id} className="hs-card">
                <h3>{s.name}</h3>
                <p className="hs-hint" style={{ marginBottom: 8 }}>For {s.businessLabel.toLowerCase()}s</p>
                <p>{s.tagline ?? s.description ?? `Run your ${s.businessLabel.toLowerCase()} on one connected system.`}</p>
                {s.website && <p style={{ marginTop: 12 }}><a className="hs-link" href={s.website} target="_blank" rel="noopener noreferrer">Visit site <Icon name="external" size={14} /></a></p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hs-section hs-section-soft" id="types">
        <div className="hs-container">
          <SectionHead eyebrow="Partner types" title="Pick how you want to work" intro="Your exact terms are confirmed when you are approved." />
          <div className="hs-grid hs-grid-3">
            {types.map((t) => (
              <div key={t.id} className="hs-card hs-type">
                <h3>{t.name}</h3>
                <p className="hs-rate">{t.key === "EXCLUSIVE" ? <>Rate set for you<small>up to {Number(t.defaultRate)}%</small></> : <>{Number(t.defaultRate)}%<small>recurring</small></>}</p>
                <p>{t.description}</p>
                <p className="hs-hint" style={{ marginTop: 10 }}>{durationLabel(t.defaultDurationMonths)}{t.leadSharing ? " · receives Hifi leads in your territory" : " · no Hifi leads"}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hs-section" id="how">
        <div className="hs-container">
          <SectionHead eyebrow="How it works" title="From application to first commission" />
          <ol className="hs-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="hs-step-n">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hs-section hs-section-soft" id="who">
        <div className="hs-container">
          <SectionHead eyebrow="Who can join" title="If you can start a conversation, you can partner with us" />
          <ul className="hs-chips">{WHO.map((w) => <li key={w}><Icon name="check" size={16} /> {w}</li>)}</ul>
        </div>
      </section>

      <section className="hs-section" id="calculator">
        <div className="hs-container hs-narrow">
          <SectionHead eyebrow="Earnings calculator" title="See what your clients could be worth" />
          <Calculator types={types.map((t) => ({ key: t.key, name: t.name, rate: t.key === "EXCLUSIVE" ? null : Number(t.defaultRate) }))} price={Number(settings.calculator_price) || 0} currency={settings.calculator_currency} />
        </div>
      </section>

      <section className="hs-section hs-section-soft" id="benefits">
        <div className="hs-container">
          <SectionHead eyebrow="Benefits" title="Why partners choose Hifi" />
          <div className="hs-grid hs-grid-3">
            {[
              ["Recurring income", "You earn again every time your client pays, not once."],
              ["Certified to sell", "A verifiable certificate for every Solution you are approved for."],
              ["Your own portal", "See your clients, commissions and certificates in one place."],
              ["Real products", "Working ERP Solutions with demos you can show today."],
              ["Support from Hifi", "Brand assets, pitch notes and a team to help you close."],
              ["Fair and recorded", "Every commission change is logged and visible to you."],
            ].map(([t, d]) => <div key={t} className="hs-card"><h3>{t}</h3><p>{d}</p></div>)}
          </div>
        </div>
      </section>

      <section className="hs-section" id="faq">
        <div className="hs-container hs-narrow">
          <SectionHead eyebrow="FAQ" title="Questions partners ask" />
          <div className="hs-faq">{faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </section>

      <section className="hs-section hs-section-soft" id="apply">
        <div className="hs-container hs-narrow">
          <SectionHead eyebrow="Apply" title="Become a Hifi partner" intro="It takes about three minutes." />
          <div className="hs-card"><ApplicationForm types={typeOptions} solutions={solutions.map((s) => ({ code: s.code, name: s.name }))} terms={settings.terms_text} /></div>
        </div>
      </section>

      <section className="hs-section" id="ask">
        <div className="hs-container hs-narrow">
          <SectionHead eyebrow="Questions" title="Ask our partner team" intro="Not ready to apply? Ask us anything first." />
          <div className="hs-card"><InquiryForm types={typeOptions} /></div>
          <p className="hs-hint" style={{ marginTop: 16, textAlign: "center" }}>Already a partner? <Link href="/login">Sign in to Hifi Partner Stack</Link>. Check a certificate at <code>/partners/verify/&lt;id&gt;</code>.</p>
        </div>
      </section>
    </>
  );
}
