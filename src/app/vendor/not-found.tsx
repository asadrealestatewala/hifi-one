import NotFoundView from "@/components/ui/NotFoundView";

// Shown inside the vendor portal when a bill, document or work order does not exist or belongs to another vendor.
export default function NotFound() {
  return <NotFoundView home="/vendor" homeLabel="Back to your portal" />;
}
