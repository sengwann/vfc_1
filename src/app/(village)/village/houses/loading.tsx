import { Skeleton } from "@/components/ui/skeleton";

export default function HousesLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full sm:w-36" />
      </div>

      {/* Search and filters */}
      <div className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton className="h-9 w-24" key={index} />
          ))}
        </div>
      </div>

      {/* House rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton className="h-[4.5rem] w-full rounded-xl" key={index} />
        ))}
      </div>
    </div>
  );
}
