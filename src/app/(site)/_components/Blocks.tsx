import Image from "next/image";
import Link from "next/link";
import { postExcerpt, type Post } from "../_content/blog";
import { type Plan, SERVICES, STATS } from "../_content/site";
import { Icon } from "./Icon";

// Building blocks shared by several website pages.

export function PageHero({ eyebrow, title, intro, crumbs, children }: { eyebrow?: string; title: string; intro?: string; crumbs?: { href: string; label: string }[]; children?: React.ReactNode }) {
  return (
    <section className="hs-page-hero">
      <div className="hs-container">
        {crumbs && (
          <nav aria-label="Breadcrumb">
            <ol className="hs-crumbs">
              {crumbs.map((c) => <li key={c.href}><Link href={c.href}>{c.label}</Link></li>)}
            </ol>
          </nav>
        )}
        {eyebrow && <span className="hs-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
        {children}
      </div>
    </section>
  );
}

export function SectionHead({ eyebrow, title, intro, left, as: H = "h2" }: { eyebrow?: string; title: string; intro?: string; left?: boolean; as?: "h1" | "h2" }) {
  return (
    <div className={`hs-head${left ? " left" : ""}`}>
      {eyebrow && <span className="hs-eyebrow">{eyebrow}</span>}
      <H className="hs-h2">{title}</H>
      {intro && <p>{intro}</p>}
    </div>
  );
}

export function ServiceCards() {
  return (
    <div className="hs-grid hs-grid-4">
      {SERVICES.map((s, i) => (
        <Link key={s.id} href={`/site/services#${s.id}`} className="hs-card hs-service">
          <div className="hs-media">
            <Image src={s.image.src} alt="" width={s.image.width} height={s.image.height} sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 300px" />
          </div>
          <div className="hs-body">
            <span className="hs-num">{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.title}</h3>
            <p>{s.summary}</p>
            <span className="hs-link">Learn more <Icon name="arrow" size={16} /></span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function Stats() {
  return (
    <ul className="hs-stats" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {STATS.map((s) => (
        <li key={s.label} className="hs-stat"><strong>{s.value}</strong><span>{s.label}</span></li>
      ))}
    </ul>
  );
}

export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <article className={`hs-card hs-plan${plan.popular ? " popular" : ""}`}>
      {plan.popular && <span className="hs-badge">{plan.popular}</span>}
      <h3>{plan.name}</h3>
      <p className="hs-muted">{plan.sub}</p>
      <p className="hs-price">{plan.price}<span aria-label=" or more">+</span></p>
      <p className="hs-price-note">{plan.note === "One-time" ? "One-time project price" : plan.note}</p>
      <ul className="hs-plan-lines">
        {plan.lines.map((l) => <li key={l.label}><span>{l.label}</span><span>{l.value}</span></li>)}
      </ul>
      {plan.delivery && <p className="hs-delivery"><Icon name="clock" size={15} /> Delivery in {plan.delivery}</p>}
      <Link href={`/site/contact?plan=${encodeURIComponent(plan.name)}`} className={`hs-btn${plan.popular ? "" : " hs-btn-ghost"}`}>
        Book {plan.name} <span className="hs-sr">plan</span>
      </Link>
    </article>
  );
}

export function CtaBand({ title = "Ready to transform your business?", text = "Tell us what you need and we will reply with a plan and a quote.", primary = { href: "/site/contact", label: "Get a free quote" }, secondary = { href: "/site/pricing", label: "See pricing" } }: { title?: string; text?: string; primary?: { href: string; label: string }; secondary?: { href: string; label: string } | null }) {
  return (
    <section className="hs-section-tight">
      <div className="hs-container">
        <div className="hs-cta">
          <div>
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
          <div className="hs-actions">
            <Link href={primary.href} className="hs-btn">{primary.label} <Icon name="arrow" size={16} /></Link>
            {secondary && <Link href={secondary.href} className="hs-btn hs-btn-ghost">{secondary.label}</Link>}
          </div>
        </div>
      </div>
    </section>
  );
}

export const formatDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function PostCard({ post, headingLevel = 2, stacked = false }: { post: Post; headingLevel?: 2 | 3; stacked?: boolean }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={`hs-card hs-post-card${stacked ? " stacked" : ""}`}>
      <div className="hs-media">
        <Image src={post.cover.src} alt="" fill sizes="(max-width: 800px) 100vw, 600px" />
      </div>
      <div className="hs-body">
        <span className="hs-chip"><Icon name="calendar" size={14} /> <time dateTime={post.date}>{formatDate(post.date)}</time></span>
        <H><Link href={`/site/blog/${post.slug}`}>{post.title}</Link></H>
        <p>{postExcerpt(post)}</p>
        <Link href={`/site/blog/${post.slug}`} className="hs-link" aria-hidden="true" tabIndex={-1}>Read the story <Icon name="arrow" size={16} /></Link>
      </div>
    </article>
  );
}
