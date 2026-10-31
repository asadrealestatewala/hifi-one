import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyForm } from "../../../../_components/ApplyForm";
import { Icon } from "../../../../_components/Icon";
import { jobById, JOBS, jobSummary } from "../../../../_content/jobs";

export const dynamicParams = false;
export function generateStaticParams() {
  return JOBS.map((j) => ({ id: String(j.id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const job = jobById(Number((await params).id));
  if (!job) return {};
  return {
    title: `${job.title} (${job.location})`,
    description: jobSummary(job).slice(0, 160) || `${job.title}, ${job.type}, ${job.location}. Apply online at HIFI Marketing & Technologies.`,
    alternates: { canonical: `/site/careers/jobs/${job.id}` },
  };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const job = jobById(Number((await params).id));
  if (!job) notFound();
  return (
    <>
      <section className="hs-page-hero">
        <div className="hs-container">
          <nav aria-label="Breadcrumb">
            <ol className="hs-crumbs">
              <li><Link href="/site/careers">Careers</Link></li>
              <li><Link href="/site/careers/jobs">Open roles</Link></li>
            </ol>
          </nav>
          <h1>{job.title}</h1>
          <ul className="hs-meta" style={{ fontSize: 16 }}>
            <li><Icon name="briefcase" size={16} /> {job.department}</li>
            <li><Icon name="pin" size={16} /> {job.location}</li>
            <li><Icon name="clock" size={16} /> {job.type}</li>
            {job.workplace && <li><Icon name="laptop" size={16} /> {job.workplace}</li>}
          </ul>
          <div className="hs-actions" style={{ marginTop: 24 }}>
            <a href="#apply" className="hs-btn">Apply now <Icon name="arrow" size={16} /></a>
          </div>
        </div>
      </section>
      <section className="hs-section">
        <div className="hs-container hs-job-layout">
          <div className="hs-prose">
            {job.sections.map((s) => (
              <div key={s.heading}>
                <h2>{s.heading}</h2>
                {s.paragraphs.map((p) => <p key={p}>{p}</p>)}
                {s.items.length > 0 && <ul>{s.items.map((i) => <li key={i}><Icon name="check" size={16} /> <span>{i}</span></li>)}</ul>}
              </div>
            ))}
            <p style={{ marginTop: 32 }}><Link href="/site/careers/jobs" className="hs-link"><Icon name="back" size={16} /> Back to all roles</Link></p>
          </div>
          <aside id="apply" className="hs-card" aria-labelledby="apply-title" style={{ scrollMarginTop: 96 }}>
            <h2 id="apply-title" style={{ fontSize: 22, margin: "0 0 4px" }}>Apply for this role</h2>
            <p className="hs-muted" style={{ margin: "0 0 20px", fontSize: 15 }}>{job.title} &middot; {job.location}</p>
            <ApplyForm jobId={job.id} jobTitle={job.title} />
          </aside>
        </div>
      </section>
    </>
  );
}
