// Shown while the Academy loads.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-48" />
      <div className="skeleton h-32" />
    </div>
  );
}
