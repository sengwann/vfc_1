import { Skeleton } from "@/components/ui/skeleton";

export default function PlatformAuditLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      {/* Filters: toggle on phones, fields from md */}
      <div className="rounded-xl border bg-card p-4 sm:p-6">
        <Skeleton className="h-11 w-full rounded-lg md:hidden" />
        <div className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="space-y-2" key={index}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="h-4 w-36" />

      {/* Day group */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <div className="divide-y rounded-xl border bg-card">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="space-y-2 px-4 py-3 sm:px-5" key={index}>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-11 w-28" />
      </div>
    </div>
  );
}
