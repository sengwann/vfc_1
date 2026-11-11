import type { ReactNode } from "react";
import { LanguagePreference, MembershipStatus } from "@prisma/client";
import type { SessionUser } from "../../../lib/auth/auth.types";
import { getT } from "../../../lib/i18n/translations";
import type { ShellNavigation } from "../lib/navigation";
import { AppHeader } from "./app-header";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { PendingMembershipBanner } from "./pending-membership-banner";
import { SidebarNavigation } from "./sidebar-navigation";

/*
 * Responsive shell
 *  - phones (<768px): sticky top bar, content, bottom tab bar + Menu sheet
 *  - tablet (md):     72px icon rail + top bar + content
 *  - desktop (lg):    256px sidebar + top bar + content
 * `lang` is set per user so browsers pick Myanmar fonts and shaping rules.
 */
export function AppShell({
  user,
  navigation,
  variant,
  language = LanguagePreference.EN,
  awaitingChiefApproval = false,
  children,
}: {
  user: SessionUser;
  navigation: ShellNavigation;
  variant: "platform" | "village";
  language?: LanguagePreference;
  /** Pending member whose house has no head yet: the Chief decides. */
  awaitingChiefApproval?: boolean;
  children: ReactNode;
}) {
  const t = getT(language);

  return (
    <div
      className="min-h-dvh bg-background text-foreground md:flex"
      lang={language === LanguagePreference.MY ? "my" : "en"}
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        href="#main-content"
      >
        {t("shell.skipToContent")}
      </a>

      <aside className="hidden shrink-0 border-r bg-card md:block md:w-[4.5rem] lg:w-64">
        <div className="sticky top-0 h-dvh">
          <SidebarNavigation
            items={navigation.sidebarItems}
            variant={variant}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          items={navigation.sidebarItems}
          user={user}
          variant={variant}
        />
        <main
          className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 outline-none sm:px-6 md:pb-10 md:pt-6 lg:px-8"
          id="main-content"
          tabIndex={-1}
        >
          {variant === "village" &&
          user.membershipStatus === MembershipStatus.PENDING ? (
            <PendingMembershipBanner
              awaitingChiefApproval={awaitingChiefApproval}
            />
          ) : null}
          {children}
        </main>
      </div>

      <MobileBottomNavigation
        allItems={navigation.sidebarItems}
        items={navigation.mobileItems}
        user={user}
        variant={variant}
      />
    </div>
  );
}