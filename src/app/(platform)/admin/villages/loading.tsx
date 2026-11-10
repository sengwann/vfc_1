import { Skeleton } from "@/components/ui/skeleton";

export default function VillagesLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-11 w-full sm:w-44" />
      </div>

      {/* Search and filters */}
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="h-11 w-28 shrink-0 rounded-full" key={index} />
          ))}
        </div>
      </div>

      <Skeleton className="h-4 w-48" />

      {/* Village rows */}
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="space-y-2 rounded-xl border bg-card p-4" key={index}>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
