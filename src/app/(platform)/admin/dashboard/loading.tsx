import { Skeleton } from "@/components/ui/skeleton";

export default function AdminDashboardLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-11 w-full sm:w-40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        {/* Status summary */}
        <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>

        {/* Recent villages */}
        <div className="space-y-3 lg:col-span-2">
          <Skeleton className="h-5 w-40" />
          <div className="divide-y rounded-xl border bg-card">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="space-y-2 px-4 py-3 sm:px-5" key={index}>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}