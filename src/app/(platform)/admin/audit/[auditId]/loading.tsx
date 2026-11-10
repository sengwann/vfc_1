import { Skeleton } from "@/components/ui/skeleton";

export default function PlatformAuditDetailLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              className="flex items-center justify-between gap-4"
              key={index}
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="space-y-1.5" key={index}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
