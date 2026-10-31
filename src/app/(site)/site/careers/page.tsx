import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CtaBand, SectionHead } from "../../_components/Blocks";
import { Icon } from "../../_components/Icon";
import { JOBS } from "../../_content/jobs";
import { BENEFIT_PHOTO, BENEFITS, CULTURE, GLOBAL, HIRING_STEPS, PATHWAYS } from "../../_content/site";

export const metadata: Metadata = {
  title: "Careers",
  description: "Build your career at HIFI Marketing & Technologies. See open roles in development, design, digital marketing, finance and sales, and apply online.",
  alternates: { canonical: "/site/careers" },
};

export default function CareersPage() {
  const latest = JOBS.slice(0, 4);
  return (
    <>
      <section className="hs-careers-hero">
        <Image src="/site/images/careershero.avif" alt="" fill priority sizes="100vw" />
        <div className="hs-container">
          <span className="hs-eyebrow">Careers</span>
          <h1>Where people drive innovation</h1>
          <p>We are more than a workplace. We are a people-first community that grows stronger together.</p>
          <div className="hs-actions">
            <Link href="/site/careers/jobs" className="hs-btn">See {JOBS.length} open roles <Icon name="arrow" size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container">
          <SectionHead eyebrow="How hiring works" title="Your path to joining HIFI" />
          <ol className="hs-steps">
            {HIRING_STEPS.map((s) => (
              <li key={s.title}>
                <div className="hs-step-img"><Image src={s.image} alt="" width={400} height={400} sizes="120px" /></div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hs-section hs-section-soft">
        <div className="hs-container">
          <SectionHead eyebrow="Open roles" title="Latest openings" intro="Apply online in a few minutes. Our HR team reviews every application." />
          <ul className="hs-job-list">
            {latest.map((j) => (
              <li key={j.id} className="hs-card hs-job">
                <div>
                  <h3><Link href={`/site/careers/jobs/${j.id}`}>{j.title}</Link></h3>
                  <ul className="hs-meta">
                    <li><Icon name="briefcase" size={15} /> {j.department}</li>
                    <li><Icon name="pin" size={15} /> {j.location}</li>
                    <li><Icon name="clock" size={15} /> {j.type}</li>
                  </ul>
                </div>
                {j.workplace && <span className="hs-chip">{j.workplace}</span>}
              </li>
            ))}
          </ul>
          <p style={{ textAlign: "center", marginTop: 28 }}><Link href="/site/careers/jobs" className="hs-btn">Browse all {JOBS.length} roles</Link></p>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container">
          <SectionHead eyebrow="Career pathways" title="Your growth, our priority" intro="A clear and rewarding career path to help you develop your skills, work on meaningful projects and reach your professional goals." />
          <ul className="hs-grid-5" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {PATHWAYS.map((p) => (
              <li key={p.title} className="hs-tile">
                <Image src={p.image} alt="" width={400} height={500} sizes="(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 230px" />
                <div className="hs-tile-body"><h3>{p.title}</h3><p>{p.text}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hs-section hs-section-soft">
        <div className="hs-container">
          <SectionHead eyebrow="Global careers" title="Connecting talent across the world" intro="Talented people from diverse cultures and regions, creating impactful solutions together." />
          <ul className="hs-grid hs-grid-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {GLOBAL.map((p) => (
              <li key={p.title} className="hs-tile">
                <Image src={p.image} alt="" width={400} height={500} sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 290px" />
                <div className="hs-tile-body"><h3>{p.title}</h3><p>{p.text}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container hs-split">
          <div>
            <span className="hs-eyebrow">Benefits</span>
            <h2>Why join us: growth, impact and opportunities</h2>
            <p style={{ marginBottom: 24 }}>The perks and benefits that make HIFI a great place to work.</p>
            <ul className="hs-benefits">
              {BENEFITS.map((b) => <li key={b}><Icon name="check" size={16} /> {b}</li>)}
            </ul>
          </div>
          <div className="hs-split-media">
            <div className="hs-img-main"><Image src={BENEFIT_PHOTO} alt="A bright, busy open-plan office" width={600} height={400} sizes="(max-width: 900px) 100vw, 560px" /></div>
          </div>
        </div>
      </section>

      <section className="hs-section-tight">
        <div className="hs-container">
          <SectionHead eyebrow="Culture & lifestyle" title="Celebrating creativity and milestones" intro="A vibrant work culture of collaboration and unforgettable moments." />
          <div className="hs-gallery">
            {CULTURE.map((c) => <Image key={c.src} src={c.src} alt={c.alt} width={400} height={300} sizes="(max-width: 760px) 50vw, 230px" />)}
          </div>
        </div>
      </section>

      <CtaBand title="Ready to get started?" text="Find the role that fits you and apply online." primary={{ href: "/site/careers/jobs", label: "See open roles" }} secondary={{ href: "/site/contact", label: "Ask us a question" }} />
    </>
  );
}
