import { sitePage, sitePageNames } from "../../_lib/serve";

export const dynamic = "force-static";
export const dynamicParams = false;

// One snapshot per post that was published on the PHP blog (blog.php?id=N)
export function generateStaticParams() {
  return sitePageNames()
    .filter((n) => n.startsWith("blog-"))
    .map((n) => ({ id: n.slice("blog-".length) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sitePage(`blog-${id}`);
}
