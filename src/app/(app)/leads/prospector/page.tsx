import { requirePermission } from "@/lib/auth";
import ProspectorView from "./View";

export const dynamic = "force-dynamic";

export default async function Prospector({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("crm.view");
  return <ProspectorView searchParams={searchParams} base="/leads/prospector" />;
}
