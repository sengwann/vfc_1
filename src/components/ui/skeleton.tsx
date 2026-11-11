import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder block for loading.tsx files. Size it with width/height classes
 * (e.g. "h-4 w-40"). Hidden from assistive tech; give the surrounding region
 * its own busy/label semantics if needed. The pulse stops for users who prefer
 * reduced motion.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-border motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
