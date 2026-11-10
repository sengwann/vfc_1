import { Skeleton } from "@/components/ui/skeleton";

export default function ReceiptsLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton className="h-28 rounded-xl" key={index} />
        ))}
      </div>
    </div>
  );
}
