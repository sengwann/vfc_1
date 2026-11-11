import { Skeleton } from "@/components/ui/skeleton";

export default function FundsLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-9 w-20 rounded-lg" key={index} />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-44 rounded-xl" key={index} />
        ))}
      </div>
    </div>
  );
}
