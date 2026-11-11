import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatTone = "default" | "success" | "warning" | "danger";

const TONES: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
};

/**
 * A single labelled figure. The label always states what the number means,
 * so the tone colour is reinforcement only.
 */
export function StatCard({
  label,
  value,
  tone = "default",
  compact = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
  /** Use for text values (names) instead of numbers. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 p-3.5 sm:p-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums",
          compact ? "text-lg leading-snug break-words" : "text-2xl",
          TONES[tone],
        )}
      >
        {value}
      </p>
    </Card>
  );
}
