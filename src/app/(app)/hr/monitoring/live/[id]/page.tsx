import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPolicy } from "@/lib/monitoring";
import { Notice, PageHeader } from "@/components/ui";
import LiveViewer from "./LiveViewer";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("monitoring.live_view");
  const { id } = await params;
  const person = await db.user.findFirst({ where: { id, organizationId: user.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  if (!person) notFound();
  const policy = await getPolicy(db, user.organizationId);
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title={`Live view: ${person.name}`} subtitle="You can only watch if they accept, only the screen or window they are sharing, and they see a banner the whole time. Each view is logged where they can read it." />
      {!policy.enabled || !policy.liveView ? <Notice kind="error">Live view is not switched on in the monitoring policy.</Notice> : <LiveViewer subjectId={person.id} name={person.name} />}
    </div>
  );
}
