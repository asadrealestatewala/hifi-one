import Image from "next/image";
import Link from "next/link";
import { POSTS } from "../_content/blog";
import { JOBS } from "../_content/jobs";
import { COMPANY, EMAIL, PHONE, PLAN_GROUPS, PLATFORMS, SITE_URL, SOCIALS } from "../_content/site";
import { CtaBand, PlanCard, PostCard, SectionHead, ServiceCards, Stats } from "./Blocks";
import { HeroVideo } from "./HeroVideo";
import { Icon } from "./Icon";

export const HOME_TITLE = `${COMPANY} | Websites, social media, ads and CRM/ERP`;

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: COMPANY,
  url: SITE_URL,
  logo: `${SITE_URL}/site/icons/icon-512.png`,
  email: EMAIL,
  telephone: PHONE,
  sameAs: SOCIALS.map((s) => s.href),
};

// The home page, served at "/" to visitors and at /site for everyone.
export function Home() {
  const websitePlans = PLAN_GROUPS[0];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }} />
      <section className="hs-hero">
        <div className="hs-container hs-hero-grid">
          <div>
            <span className="hs-eyebrow">Digital agency</span>
            <h1>We are digital design <em>creators</em></h1>
            <p className="lead">From concept to creation: websites, social media, ads and CRM/ERP systems that captivate audiences and grow your business.</p>
            <div className="hs-actions">
              <Link href="/site/contact" className="hs-btn">Get a free quote <Icon name="arrow" size={16} /></Link>
              <Link href="/site/services" className="hs-btn hs-btn-ghost">Explore our work</Link>
            </div>
            <ul className="hs-hero-points">
              <li><Icon name="check" size={16} /> Websites from AED 999</li>
              <li><Icon name="check" size={16} /> 500+ projects delivered</li>
              <li><Icon name="check" size={16} /> Offices in PK, UAE, UK, US</li>
            </ul>
          </div>
          <div className="hs-hero-media">
            <HeroVideo />
          </div>
        </div>
      </section>

      <section className="hs-platforms" aria-labelledby="platforms-title">
        <div className="hs-container">
          <p id="platforms-title">Platforms we build and run campaigns on</p>
          <ul>{PLATFORMS.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container">
          <SectionHead eyebrow="Services" title="Explore what we can do for you" intro="Four practices, one team: we design, build, promote and automate." />
          <ServiceCards />
        </div>
      </section>

      <section className="hs-section hs-section-soft">
        <div className="hs-container hs-split">
          <div className="hs-split-media">
            <div className="hs-img-main"><Image src="/site/images/left.jpg" alt="The HIFI team's open-plan office" width={500} height={375} sizes="(max-width: 900px) 100vw, 560px" /></div>
            <div className="hs-img-float"><Image src="/site/images/right.webp" alt="A developer at work on code" width={600} height={400} sizes="(max-width: 900px) 52vw, 300px" /></div>
          </div>
          <div>
            <span className="hs-eyebrow">About us</span>
            <h2>We are leading digital transformation experts</h2>
            <p>At HIFI Marketing &amp; Technologies, we craft custom digital solutions that drive real business growth. From website design and development to social media management, CRM automation and targeted advertising, we tailor our services to your business and deliver measurable results.</p>
            <ul className="hs-checks">
              <li><Icon name="check" size={16} /> Idea, insight, solution: one team from strategy to launch</li>
              <li><Icon name="check" size={16} /> Clear one-time and monthly pricing in AED</li>
              <li><Icon name="check" size={16} /> A client portal to follow your projects, approvals and invoices</li>
            </ul>
            <div className="hs-actions" style={{ marginTop: 28 }}>
              <Link href="/site/about" className="hs-link">More about us <Icon name="arrow" size={16} /></Link>
              <Link href="/site/team" className="hs-link">Meet the team <Icon name="arrow" size={16} /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="hs-section-tight">
        <div className="hs-container">
          <h2 className="hs-sr">Our achievements</h2>
          <Stats />
        </div>
      </section>

      <section className="hs-section hs-section-soft">
        <div className="hs-container">
          <SectionHead eyebrow="Pricing" title="Website packages" intro="One-time project prices in AED. SEO, social media, ERP, CGI and design plans are on the pricing page." />
          <div className="hs-grid hs-grid-3">
            {websitePlans.plans.map((p) => <PlanCard key={p.name} plan={p} />)}
          </div>
          <p style={{ textAlign: "center", marginTop: 28 }}>
            <Link href="/site/pricing" className="hs-link">See all pricing plans <Icon name="arrow" size={16} /></Link>
          </p>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container hs-grid hs-grid-2" style={{ alignItems: "stretch" }}>
          <div className="hs-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="hs-eyebrow">Careers</span>
            <h2 style={{ fontSize: 28, margin: 0 }}>Join a people-first team</h2>
            <p>{JOBS.length} open roles across development, design, marketing, finance and sales. Apply online in a few minutes.</p>
            <div className="hs-actions" style={{ marginTop: "auto" }}>
              <Link href="/site/careers/jobs" className="hs-btn">See open roles</Link>
              <Link href="/site/careers" className="hs-btn hs-btn-ghost">Life at HIFI</Link>
            </div>
          </div>
          {POSTS[0] && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="hs-eyebrow">Latest news</span>
              <PostCard post={POSTS[0]} headingLevel={3} stacked />
            </div>
          )}
        </div>
      </section>

      <CtaBand />
    </>
  );
}
