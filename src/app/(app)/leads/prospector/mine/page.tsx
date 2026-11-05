import { requirePermission } from "@/lib/auth";
import ProspectorView from "../View";

export const dynamic = "force-dynamic";

// The salesperson's own list: prospects assigned to them or added by them
export default async function MyProspects({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("crm.edit");
  return <ProspectorView searchParams={searchParams} base="/leads/prospector/mine" mine />;
}
