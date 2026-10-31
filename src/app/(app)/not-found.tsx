import NotFoundView from "@/components/ui/NotFoundView";

// Shown inside the staff shell when a record does not exist or is outside the person's scope.
export default function NotFound() {
  return <NotFoundView home="/dashboard" homeLabel="Back to the dashboard" />;
}
