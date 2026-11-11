import { Landmark, ShieldCheck } from "lucide-react";
import { cn } from "../../../lib/utils";

/** Small green app mark used in the header (phones) and the sidebar. */
export function BrandMark({
  variant,
  className,
}: {
  variant: "platform" | "village";
  className?: string;
}) {
  const Icon = variant === "platform" ? ShieldCheck : Landmark;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs",
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}