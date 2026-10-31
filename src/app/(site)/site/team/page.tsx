import type { Metadata } from "next";
import Image from "next/image";
import { CtaBand, PageHero } from "../../_components/Blocks";
import { TEAM } from "../../_content/site";

export const metadata: Metadata = {
  title: "Our team",
  description: "Meet the HIFI Marketing & Technologies team: leadership, project management, development, marketing, design and video.",
  alternates: { canonical: "/site/team" },
};

const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("");

export default function TeamPage() {
  return (
    <>
      <PageHero eyebrow="Our team" title="Our dedicated digital expert team" intro="Meet the passionate people behind your success." />
      <section className="hs-section">
        <div className="hs-container">
          <ul className="hs-grid hs-grid-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {TEAM.map((p, i) => (
              <li key={p.name} className="hs-card hs-person">
                <div className="hs-photo">
                  {p.photo ? (
                    <Image src={p.photo.src} alt={`Portrait of ${p.name}`} width={p.photo.width} height={p.photo.height} sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 280px" priority={i < 4} />
                  ) : (
                    <div className="hs-initials" aria-hidden="true">{initials(p.name)}</div>
                  )}
                </div>
                <div className="hs-body">
                  <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>{p.name}</h2>
                  <p className="hs-muted" style={{ margin: 0 }}>{p.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <CtaBand title="Want to join the team?" text="We are hiring across development, design, marketing, finance and sales." primary={{ href: "/site/careers/jobs", label: "See open roles" }} secondary={{ href: "/site/careers", label: "Life at HIFI" }} />
    </>
  );
}
