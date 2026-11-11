import { Skeleton } from "@/components/ui/skeleton";

export default function VillageDashboardLoading() {
  return (
    <div aria-busy="true" className="space-y-6 sm:space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <Skeleton className="h-16 w-full rounded-xl" />

      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="h-24 rounded-xl" key={index} />
          ))}
          <Skeleton className="col-span-2 h-24 rounded-xl lg:col-span-1" />
        </div>
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
