"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { logoutAction } from "../../auth/actions/logout.action";
import type { SessionUser } from "../../../lib/auth/auth.types";
import { useTranslation } from "../../../lib/i18n/provider";
import { Button, buttonVariants } from "../../../components/ui/button";
import { ThemeToggle } from "../../../components/ui/theme-toggle";
import type { NavItem } from "../lib/navigation";
import { findActiveItem, getInitials, getRoleLabel } from "../lib/shell-labels";
import { BrandMark } from "./brand-mark";

/*
 * Phones: brand mark + current section on the left, avatar (links to settings)
 * on the right. Log out lives in the Menu sheet of the bottom bar.
 * md+: the brand moves to the sidebar; the header shows the current section on
 * the left and the account area (name, theme, Settings, Log out) on the right.
 * On phones the theme choice lives in the Menu sheet of the bottom bar.
 */
export function AppHeader({
  user,
  variant,
  items,
}: {
  user: SessionUser;
  variant: "platform" | "village";
  items: NavItem[];
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const title =
    variant === "platform"
      ? t("shell.platformAdmin")
      : t("shell.villageFundCollection");
  const section = findActiveItem(items, pathname)?.label ?? title;
  const homeHref =
    items.find((item) => item.href && !item.disabled)?.href ?? "/";
  const initials = getInitials(user.name);

  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="flex min-h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          aria-label={title}
          className="rounded-lg md:hidden"
          href={homeHref}
        >
          <BrandMark variant={variant} />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground md:hidden">
            {title}
          </p>
          <p className="truncate text-sm font-semibold leading-snug md:text-base">
            {section}
          </p>
        </div>

        {/* Phones */}
        <Link
          aria-label={t("nav.settings")}
          className="flex size-11 shrink-0 items-center justify-center rounded-full md:hidden"
          href="/settings"
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
          >
            {initials}
          </span>
        </Link>

        {/* Tablet and desktop */}
        <div className="hidden items-center gap-3 md:flex">
          <div className="hidden max-w-56 text-right lg:block">
            <p className="truncate text-sm font-semibold leading-snug">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {getRoleLabel(t, user.role)}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
          >
            {initials}
          </span>
          <ThemeToggle variant="icon" />
          <Link
            aria-label={t("nav.settings")}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/settings"
          >
            <Settings aria-hidden />
            <span className="hidden lg:inline">{t("nav.settings")}</span>
          </Link>
          <form action={logoutAction}>
            <Button
              aria-label={t("nav.logout")}
              size="sm"
              type="submit"
              variant="outline"
            >
              <LogOut aria-hidden />
              <span className="hidden lg:inline">{t("nav.logout")}</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
