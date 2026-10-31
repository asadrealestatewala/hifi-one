import { sitePage, sitePageNames } from "../../../_lib/serve";

export const dynamic = "force-static";
export const dynamicParams = false;

// One snapshot per opening that was listed on the PHP job board (job-detail.php?id=N)
export function generateStaticParams() {
  return sitePageNames()
    .filter((n) => n.startsWith("job-"))
    .map((n) => ({ id: n.slice("job-".length) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sitePage(`job-${id}`);
}
