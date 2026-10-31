import type { Metadata } from "next";
import { PageHero, PostCard } from "../../_components/Blocks";
import { POSTS } from "../../_content/blog";

export const metadata: Metadata = {
  title: "News & media",
  description: "Stories, ideas and news from HIFI Marketing & Technologies.",
  alternates: { canonical: "/site/blog" },
};

export default function BlogPage() {
  return (
    <>
      <PageHero eyebrow="News & media" title="Stories, ideas and insights" intro="News from HIFI Marketing & Technologies and our work with clients and partners." />
      <section className="hs-section">
        <div className="hs-container" style={{ display: "grid", gap: 24 }}>
          {POSTS.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
      </section>
    </>
  );
}
