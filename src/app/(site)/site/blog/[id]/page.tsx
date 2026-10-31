import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand, formatDate } from "../../../_components/Blocks";
import { Icon } from "../../../_components/Icon";
import { postById, postExcerpt, POSTS } from "../../../_content/blog";
import { COMPANY, SITE_URL } from "../../../_content/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return POSTS.map((p) => ({ id: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const post = postById(Number((await params).id));
  if (!post) return {};
  return {
    title: post.title,
    description: postExcerpt(post, 155),
    alternates: { canonical: `/site/blog/${post.slug}` },
    openGraph: { type: "article", publishedTime: post.date, images: [{ url: post.cover.src, width: post.cover.width, height: post.cover.height }] },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const post = postById(Number((await params).id));
  if (!post) notFound();
  const jsonLd = { "@context": "https://schema.org", "@type": "NewsArticle", headline: post.title, datePublished: post.date, image: [`${SITE_URL}${post.cover.src}`], publisher: { "@type": "Organization", name: COMPANY, url: SITE_URL } };
  let firstImage = true;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="hs-section">
        <article className="hs-container hs-article">
          <nav aria-label="Breadcrumb">
            <ol className="hs-crumbs"><li><Link href="/site/blog">News &amp; media</Link></li></ol>
          </nav>
          <h1>{post.title}</h1>
          <p className="hs-meta" style={{ marginBottom: 28 }}><Icon name="calendar" size={15} /> <time dateTime={post.date}>{formatDate(post.date)}</time></p>
          <div className="hs-prose">
            {post.blocks.map((b, i) => {
              if (b.type === "image") {
                const priority = firstImage;
                firstImage = false;
                return <figure key={i}><Image src={b.src} alt="" width={b.width} height={b.height} sizes="(max-width: 760px) 100vw, 586px" priority={priority} /></figure>;
              }
              return b.type === "heading" ? <h2 key={i}>{b.text}</h2> : <p key={i}>{b.text}</p>;
            })}
          </div>
          <p style={{ marginTop: 40 }}><Link href="/site/blog" className="hs-link"><Icon name="back" size={16} /> All news</Link></p>
        </article>
      </section>
      <CtaBand title="Work with a team that delivers globally" />
    </>
  );
}
