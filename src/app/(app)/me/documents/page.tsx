import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import FilesPanel from "@/components/FilesPanel";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MyDocuments({ searchParams }: { searchParams: Promise<{ fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("self.leave");
  const { fileError, fileOk } = await searchParams;
  const hasProfile = await db.employeeProfile.findUnique({ where: { userId: user.id } });
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="My Documents" subtitle="Your own employment documents (identity, certificates, contracts). Only you and authorized HR staff can see them." />
      {hasProfile ? (
        <FilesPanel user={user} ownerType="EMPLOYEE" ownerId={user.id} returnTo="/me/documents" title="My files" withCategory withExpiry flash={{ fileError, fileOk }} />
      ) : (
        <div className="card text-sm text-muted">You do not have an HR profile yet. Ask HR to create one.</div>
      )}
    </div>
  );
}
