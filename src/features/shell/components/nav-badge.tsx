import type { NavItem } from "../lib/navigation";
import { cn } from "../../../lib/utils";

/** Count pill for a navigation item. Alert counts use the destructive tone. */
export function NavBadge({
  item,
  className,
}: {
  item: NavItem;
  className?: string;
}) {
  if (!item.badge) {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none",
        item.badgeVariant === "alert"
          ? "bg-destructive text-destructive-foreground"
          : "border border-border-strong bg-muted text-muted-foreground",
        className,
      )}
    >
      {item.badge}
    </span>
  );
}
