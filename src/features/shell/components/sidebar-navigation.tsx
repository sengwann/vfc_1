"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import type { NavItem } from "../lib/navigation";
import { isNavActive } from "../lib/shell-labels";
import { BrandMark } from "./brand-mark";
import { NavBadge } from "./nav-badge";
import { NavIcon } from "./nav-icon";
import { cn } from "../../../lib/utils";
import { useTranslation } from "../../../lib/i18n/provider";

/*
 * Tablet (md): a 72px icon rail. Desktop (lg): a 256px sidebar with labels.
 * Labels stay in the DOM on the rail (sr-only) and as a title tooltip, so the
 * links keep their accessible names. Labels wrap instead of truncating so long
 * Burmese strings stay readable.
 */
export function SidebarNavigation({
  items,
  variant,
}: {
  items: NavItem[];
  variant: "platform" | "village";
}) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const title =
    variant === "platform"
      ? t("shell.platformAdmin")
      : t("shell.villageFundCollection");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:justify-center md:px-0 lg:justify-start lg:px-5">
        <BrandMark variant={variant} />
        <p className="hidden min-w-0 text-sm font-semibold leading-snug lg:block">
          {title}
        </p>
      </div>

      <nav
        aria-label={t("shell.mainNavigation")}
        className="flex-1 overflow-y-auto p-3"
      >
        <ul className="space-y-1">
          {items.map((item) => {
            const labelClass =
              "sr-only min-w-0 flex-1 lg:not-sr-only lg:[overflow-wrap:anywhere]";

            if (!item.href || item.disabled) {
              return (
                <li key={item.label}>
                  <span
                    aria-disabled="true"
                    className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground opacity-70 md:justify-center lg:justify-start"
                    title={`${item.label} — ${t("shell.unavailable")}`}
                  >
                    <NavIcon className="size-5 shrink-0" name={item.iconName} />
                    <span className={labelClass}>{item.label}</span>
                    <Lock aria-hidden className="hidden size-4 lg:block" />
                    <span className="sr-only">{t("shell.unavailable")}</span>
                  </span>
                </li>
              );
            }

            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.label}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors md:justify-center lg:justify-start",
                    active
                      ? "bg-accent font-semibold text-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  href={item.href}
                  title={item.label}
                >
                  <span className="relative shrink-0">
                    <NavIcon className="size-5" name={item.iconName} />
                    <NavBadge
                      className="absolute -right-3 -top-2.5 lg:hidden"
                      item={item}
                    />
                  </span>
                  <span className={labelClass}>{item.label}</span>
                  <NavBadge className="hidden lg:inline-flex" item={item} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
