import { cn } from "@/lib/utils";

/*
 * Thin progress bar. Presentation only: pass an already-computed percentage
 * (0–100) and an already-translated label. The percentage should also be
 * printed as text next to the bar so colour is not the only signal.
 */
export function FundProgressBar({
  percent,
  label,
  className,
}: {
  percent: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      className={cn(
        "h-2.5 w-full overflow-hidden rounded-full border border-border-strong bg-muted",
        className,
      )}
      role="progressbar"
    >
      <div
        className={cn(
          "h-full rounded-full",
          percent >= 100 ? "bg-success" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
