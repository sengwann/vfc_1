"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Settings, X } from "lucide-react";
import { logoutAction } from "../../auth/actions/logout.action";
import type { SessionUser } from "../../../lib/auth/auth.types";
import { useTranslation } from "../../../lib/i18n/provider";
import { Button, buttonVariants } from "../../../components/ui/button";
import { ThemeToggle } from "../../../components/ui/theme-toggle";
import { cn } from "../../../lib/utils";
import type { NavItem } from "../lib/navigation";
import { isNavActive } from "../lib/shell-labels";
import { NavBadge } from "./nav-badge";
import { NavIcon } from "./nav-icon";
import { ShellUserSummary } from "./shell-user-summary";

/** Tabs shown in the bar. The rest of the navigation lives in the Menu sheet. */
const MAX_PRIMARY_TABS = 4;

const TAB_BASE =
  "relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 pb-1.5 pt-1 text-center text-[11px] leading-tight sm:text-xs";

function TabLabel({ children }: { children: ReactNode }) {
  return (
    <span className="line-clamp-2 max-w-full [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

function IconPill({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
        active ? "bg-accent text-accent-foreground" : "",
      )}
    >
      {children}
    </span>
  );
}

/*
 * Menu trigger + modal sheet. It uses the native <dialog> element so focus is
 * trapped, Escape closes it and the page behind is inert without extra code.
 * The parent keys this component by pathname, so it also resets (closes) on
 * every navigation.
 */
function MobileMenu({
  allItems,
  hasHiddenAlert,
  user,
  variant,
}: {
  allItems: NavItem[];
  hasHiddenAlert: boolean;
  user: SessionUser;
  variant: "platform" | "village";
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const themeLabelId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function openMenu() {
    dialogRef.current?.showModal();
    setOpen(true);
  }

  function closeMenu() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(TAB_BASE, "text-muted-foreground")}
        onClick={openMenu}
        type="button"
      >
        <IconPill active={false}>
          <Menu aria-hidden className="size-5" />
          {hasHiddenAlert ? (
            <span className="absolute right-2 top-0.5 size-2.5 rounded-full border-2 border-card bg-destructive" />
          ) : null}
        </IconPill>
        <TabLabel>{t("shell.menu")}</TabLabel>
        {hasHiddenAlert ? (
          <span className="sr-only">{t("shell.hasAlerts")}</span>
        ) : null}
      </button>

      <dialog
        aria-label={t("shell.menu")}
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-2xl border bg-card p-0 text-card-foreground shadow-md backdrop:bg-black/50 md:hidden"
        onClick={(event) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (event.target === event.currentTarget) closeMenu();
        }}
        onClose={() => setOpen(false)}
        ref={dialogRef}
      >
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start gap-2 border-b p-4">
            <div className="min-w-0 flex-1">
              <ShellUserSummary user={user} variant={variant} />
            </div>
            <Button
              aria-label={t("shell.closeMenu")}
              onClick={closeMenu}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-3">
            <nav aria-label={t("shell.mainNavigation")}>
              <ul className="space-y-1">
                {allItems.map((item) => {
                  if (!item.href || item.disabled) {
                    return (
                      <li key={item.label}>
                        <span
                          aria-disabled="true"
                          className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground opacity-70"
                        >
                          <NavIcon
                            className="size-5 shrink-0"
                            name={item.iconName}
                          />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                            {item.label}
                          </span>
                          <span className="text-xs">
                            {t("shell.unavailable")}
                          </span>
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
                          "flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          active
                            ? "bg-accent font-semibold text-accent-foreground"
                            : "text-foreground hover:bg-muted",
                        )}
                        href={item.href}
                        onClick={closeMenu}
                      >
                        <NavIcon
                          className="size-5 shrink-0"
                          name={item.iconName}
                        />
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          {item.label}
                        </span>
                        <NavBadge item={item} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <div className="grid gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="space-y-2">
              <p
                className="text-xs font-semibold text-muted-foreground"
                id={themeLabelId}
              >
                {t("settings.appearance")}
              </p>
              <ThemeToggle aria-labelledby={themeLabelId} />
            </div>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/settings"
              onClick={closeMenu}
            >
              <Settings aria-hidden />
              {t("nav.settings")}
            </Link>
            <form action={logoutAction}>
              <Button className="w-full" type="submit" variant="outline">
                <LogOut aria-hidden />
                {t("nav.logout")}
              </Button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function MobileBottomNavigation({
  items,
  allItems,
  user,
  variant,
}: {
  /** Items the existing navigation config marks for the phone bar. */
  items: NavItem[];
  /** The full role-specific list (same one the sidebar uses). */
  allItems: NavItem[];
  user: SessionUser;
  variant: "platform" | "village";
}) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const primary = items.slice(0, MAX_PRIMARY_TABS);
  const primaryHrefs = new Set(primary.map((item) => item.href));
  const hasHiddenAlert = allItems.some(
    (item) =>
      item.badgeVariant === "alert" &&
      item.badge &&
      !item.disabled &&
      !primaryHrefs.has(item.href),
  );

  return (
    <nav
      aria-label={t("shell.mainNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/90 md:hidden"
    >
      <div className="grid auto-cols-fr grid-flow-col">
        {primary.map((item) => {
          if (!item.href || item.disabled) {
            return (
              <span
                aria-disabled="true"
                className={cn(TAB_BASE, "text-muted-foreground opacity-60")}
                key={item.label}
              >
                <IconPill active={false}>
                  <NavIcon className="size-5" name={item.iconName} />
                </IconPill>
                <TabLabel>{item.label}</TabLabel>
                <span className="sr-only">{t("shell.unavailable")}</span>
              </span>
            );
          }
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                TAB_BASE,
                active
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
              href={item.href}
              key={item.label}
            >
              <IconPill active={active}>
                <NavIcon className="size-5" name={item.iconName} />
                <NavBadge
                  className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]"
                  item={item}
                />
              </IconPill>
              <TabLabel>{item.label}</TabLabel>
            </Link>
          );
        })}

        <MobileMenu
          allItems={allItems}
          hasHiddenAlert={hasHiddenAlert}
          key={pathname}
          user={user}
          variant={variant}
        />
      </div>
    </nav>
  );
}
