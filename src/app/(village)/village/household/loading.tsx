import { Skeleton } from "@/components/ui/skeleton";

export default function HouseholdLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="col-span-2 h-20 rounded-xl sm:col-span-1" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
