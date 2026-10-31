import PageSkeleton from "@/components/ui/PageSkeleton";

// Shown at once while the pipeline board loads its cards
export default function Loading() {
  return <PageSkeleton variant="board" />;
}
