import { Skeleton } from "@/components/ui/skeleton";

export default function ReceiptDetailLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-11 w-36" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-full max-w-xs" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <div className="space-y-6 lg:col-span-3">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
