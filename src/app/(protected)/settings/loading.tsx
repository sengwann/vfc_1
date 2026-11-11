import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ fields }: { fields: number }) {
  return (
    <div className="space-y-5 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4 max-w-xs" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: fields }, (_, index) => (
          <div className="space-y-2" key={index}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-11 w-full sm:ml-auto sm:w-36" />
    </div>
  );
}

export default function SettingsLoading() {
  return (
    <main aria-busy="true" className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
        <div className="space-y-3">
          <Skeleton className="h-11 w-40" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-11 w-full sm:w-28" />
        </div>

        <div className="space-y-4 sm:space-y-6">
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
            <Skeleton className="h-32 w-full" />
          </div>
          <CardSkeleton fields={1} />
          <CardSkeleton fields={4} />
          <CardSkeleton fields={3} />
        </div>
      </div>
    </main>
  );
}
