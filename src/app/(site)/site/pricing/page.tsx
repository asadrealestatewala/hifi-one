import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, PageHero, PlanCard } from "../../_components/Blocks";
import { Icon } from "../../_components/Icon";
import { PLAN_GROUPS } from "../../_content/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Transparent pricing in AED: website packages from AED 999 one-time, plus monthly SEO, social media and ERP plans, and per-project CGI, 3D and creative design.",
  alternates: { canonical: "/site/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Transparent pricing" title="Our pricing" intro="All prices are in AED. Website packages are one-time project prices; SEO, social media and ERP are monthly. No hidden fees, no surprises." />
      <section className="hs-section">
        <div className="hs-container">
          <nav aria-label="Pricing categories">
            <ul className="hs-tabs">
              {PLAN_GROUPS.map((g) => <li key={g.id}><a href={`#${g.id}`}>{g.title}</a></li>)}
            </ul>
          </nav>
          {PLAN_GROUPS.map((g) => (
            <section key={g.id} id={g.id} className="hs-plan-group" aria-labelledby={`${g.id}-title`}>
              <h2 id={`${g.id}-title`}>{g.title}</h2>
              <p className="hs-muted">{g.blurb} Prices start from the amount shown.</p>
              <div className="hs-grid hs-grid-3">
                {g.plans.map((p) => <PlanCard key={p.name} plan={p} />)}
              </div>
            </section>
          ))}
          <p style={{ textAlign: "center", marginTop: 48 }}>
            Need something custom? <Link href="/site/contact" className="hs-link">Request a custom quote <Icon name="arrow" size={16} /></Link>
          </p>
        </div>
      </section>
      <CtaBand title="Not sure which plan fits?" text="Tell us about your business and goals, and we will recommend a plan." secondary={{ href: "/site/services", label: "Compare services" }} />
    </>
  );
}
