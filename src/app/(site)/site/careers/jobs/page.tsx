import type { Metadata } from "next";
import { PageHero } from "../../../_components/Blocks";
import { JobBoard } from "../../../_components/JobBoard";
import { JOBS } from "../../../_content/jobs";

export const metadata: Metadata = {
  title: "Open roles",
  description: `${JOBS.length} open roles at HIFI Marketing & Technologies in Rawalpindi, Lahore and Riyadh: development, design, digital marketing, finance, data science and sales.`,
  alternates: { canonical: "/site/careers/jobs" },
};

export default function JobsPage() {
  return (
    <>
      <PageHero eyebrow="Careers" title="Open roles" intro="Search by title, or filter by department, type, workplace and location. Every role takes an online application." crumbs={[{ href: "/site/careers", label: "Careers" }, { href: "/site/careers/jobs", label: "Open roles" }]} />
      <section className="hs-section">
        <div className="hs-container">
          <JobBoard jobs={JOBS.map(({ id, title, department, location, type, workplace }) => ({ id, title, department, location, type, workplace }))} />
        </div>
      </section>
    </>
  );
}
