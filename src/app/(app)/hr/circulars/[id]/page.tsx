import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CIRCULAR_KINDS, circularReport } from "@/lib/circulars";
import { Badge, Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CircularDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const user = await requirePermission("circulars.send");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await circularReport(db, user.organizationId, id);
  if (!r) notFound();
  const c = r.circular;
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title={c.title} subtitle={<>{CIRCULAR_KINDS[c.kind as keyof typeof CIRCULAR_KINDS] ?? c.kind} · sent {c.createdAt.toISOString().slice(0, 16).replace("T", " ")} to {c.audienceLabel} · <Link href="/hr/circulars" className="underline">All circulars</Link></>} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <div className="card whitespace-pre-wrap text-sm">{c.body}</div>
      <section className="card !p-0">
        <h2 className="px-4 pt-4 font-semibold">{r.acknowledged} of {r.recipients.length} confirmed</h2>
        <ul className="mt-2 divide-y divide-border">{r.recipients.map((p) => (
          <li key={p.userId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>{p.name}</span>
            {p.ackAt ? <Badge tone="success">read {p.ackAt.toISOString().slice(0, 16).replace("T", " ")}</Badge> : <Badge tone="warning">not yet</Badge>}
          </li>
        ))}</ul>
      </section>
    </div>
  );
}
