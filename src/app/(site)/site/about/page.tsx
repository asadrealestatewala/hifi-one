import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CtaBand, PageHero, SectionHead, Stats } from "../../_components/Blocks";
import { Icon } from "../../_components/Icon";
import { OFFICES, SERVICES } from "../../_content/site";

export const metadata: Metadata = {
  title: "About us",
  description: "HIFI Marketing & Technologies crafts custom digital solutions: websites, social media, CRM automation and targeted advertising, from offices in Pakistan, the UAE, the UK and the US.",
  alternates: { canonical: "/site/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About us" title="We are leading digital transformation experts" intro="Idea, insight, solution. We help businesses grow with digital work that is designed around their goals." />
      <section className="hs-section">
        <div className="hs-container hs-split">
          <div className="hs-split-media">
            <div className="hs-img-main"><Image src="/site/images/left.jpg" alt="The HIFI team's open-plan office" width={500} height={375} sizes="(max-width: 900px) 100vw, 560px" priority /></div>
            <div className="hs-img-float"><Image src="/site/images/right.webp" alt="A developer at work on code" width={600} height={400} sizes="(max-width: 900px) 52vw, 300px" /></div>
          </div>
          <div>
            <span className="hs-eyebrow">Our story</span>
            <h2>Custom digital solutions that drive real growth</h2>
            <p>At HIFI Marketing &amp; Technologies, we specialize in crafting custom digital solutions that drive real business growth. From innovative website design and development to strategic social media management, powerful CRM automation, and targeted digital advertising, we tailor our services to meet your unique business needs and deliver measurable results.</p>
            <ul className="hs-checks">
              {SERVICES.map((s) => <li key={s.id}><Icon name="check" size={16} /> <span><strong>{s.title}:</strong> {s.tagline.toLowerCase()}</span></li>)}
            </ul>
          </div>
        </div>
      </section>
      <section className="hs-section hs-section-soft">
        <div className="hs-container">
          <SectionHead eyebrow="Our achievements" title="Numbers that speak for themselves" />
          <Stats />
        </div>
      </section>
      <section className="hs-section">
        <div className="hs-container">
          <SectionHead eyebrow="Where we work" title="One team across four countries" intro="Delivery from our global center in Pakistan, with regional offices close to our clients." />
          <div className="hs-grid hs-grid-4">
            {OFFICES.map((o) => (
              <div key={o.region} className="hs-card hs-office">
                <span className="hs-kind">{o.kind}</span>
                <h3><Icon name="pin" size={16} /> {o.region}</h3>
                {o.lines.map((l) => <p key={l}>{l}</p>)}
              </div>
            ))}
          </div>
          <p style={{ textAlign: "center", marginTop: 32 }}><Link href="/site/team" className="hs-link">Meet the people behind the work <Icon name="arrow" size={16} /></Link></p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
