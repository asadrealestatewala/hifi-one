import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPolicy } from "@/lib/monitoring";
import { Notice, PageHeader } from "@/components/ui";
import LiveViewer from "./LiveViewer";

export const dynamic = "force-dynamic";

export default async function LivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; device?: string }> }) {
  const sp = await searchParams;
  const support = sp.kind === "support";
  const user = await requirePermission(support ? "monitoring.remote_support" : "monitoring.live_view");
  const { id } = await params;
  const person = await db.user.findFirst({ where: { id, organizationId: user.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  if (!person) notFound();
  const policy = await getPolicy(db, user.organizationId);
  const phones = support ? await db.pushDevice.findMany({ where: { userId: person.id, companyOwned: true }, orderBy: { lastSeenAt: "desc" } }) : [];
  const phone = phones.find((d) => d.id === sp.device);
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title={`${support ? "Remote support" : "Live view"}: ${person.name}`} subtitle={support ? "You can only help if they accept, you must say why first, you see only the screen or window they choose to share, and they see a banner the whole time. Each session is logged where they can read it. Taking control of their mouse and keyboard is not available yet." : "You can only watch if they accept, only the screen or window they are sharing, and they see a banner the whole time. Each view is logged where they can read it."} />
      {!policy.enabled || !(support ? policy.remoteSupport : policy.liveView) ? <Notice kind="error">{support ? "Remote support" : "Live view"} is not switched on in the monitoring policy.</Notice> : <>
        {phones.length > 0 && <p className="text-sm">Help on: <a className="underline" href={`/hr/monitoring/live/${person.id}?kind=support`}>their computer</a>{phones.map((d) => <span key={d.id}> · <a className="underline" href={`/hr/monitoring/live/${person.id}?kind=support&device=${d.id}`}>{d.label ?? `company phone (${d.platform})`}</a></span>)}</p>}
        <LiveViewer key={phone?.id ?? "pc"} subjectId={person.id} name={person.name} support={support} deviceId={phone?.id} />
      </>}
    </div>
  );
}
