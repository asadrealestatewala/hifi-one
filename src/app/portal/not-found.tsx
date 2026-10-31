import NotFoundView from "@/components/ui/NotFoundView";

// Shown inside the client portal when an invoice, quote or project does not exist or belongs to another client.
export default function NotFound() {
  return <NotFoundView home="/portal" homeLabel="Back to your portal" />;
}
