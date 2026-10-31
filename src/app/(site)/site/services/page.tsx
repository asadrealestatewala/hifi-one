import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CtaBand, PageHero } from "../../_components/Blocks";
import { Icon } from "../../_components/Icon";
import { SERVICES } from "../../_content/site";

export const metadata: Metadata = {
  title: "Services: websites, social media, CRM/ERP and ads",
  description: "Website design and development, social media management, CRM/ERP implementation and Google, Meta, LinkedIn and TikTok ads management by HIFI Marketing & Technologies.",
  alternates: { canonical: "/site/services" },
};

export default function ServicesPage() {
  return (
    <>
      <PageHero eyebrow="Services" title="Explore what we can do for you" intro="Four practices under one roof. Pick one, or let us run the whole journey from your website to your ads and CRM.">
        <nav aria-label="Services on this page" style={{ marginTop: 24 }}>
          <ul className="hs-tabs" style={{ justifyContent: "flex-start", margin: 0 }}>
            {SERVICES.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
          </ul>
        </nav>
      </PageHero>
      <section className="hs-section">
        <div className="hs-container">
          {SERVICES.map((s, i) => (
            <article key={s.id} id={s.id} className="hs-service-detail" aria-labelledby={`${s.id}-title`}>
              <div className="hs-service-img">
                <Image src={s.image.src} alt="" width={s.image.width} height={s.image.height} sizes="(max-width: 860px) 100vw, 580px" priority={i === 0} />
              </div>
              <div>
                <span className="hs-eyebrow">{String(i + 1).padStart(2, "0")}</span>
                <h2 id={`${s.id}-title`}>{s.title}</h2>
                <p style={{ fontSize: 18 }}>{s.summary}</p>
                <ul className="hs-checks two">
                  {s.points.map((p) => <li key={p}><Icon name="check" size={16} /> {p}</li>)}
                </ul>
                <div className="hs-actions" style={{ marginTop: 28 }}>
                  <Link href={`/site/contact?service=${encodeURIComponent(s.title)}`} className="hs-btn">Discuss {s.title.toLowerCase()} <Icon name="arrow" size={16} /></Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <CtaBand title="Need a custom solution?" text="Tell us about your project and we will put together a plan and a quote." />
    </>
  );
}
