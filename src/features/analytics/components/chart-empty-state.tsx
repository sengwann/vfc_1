export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border-strong bg-muted/40 p-4 text-center">
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
