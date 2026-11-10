"use client";

import Link from "next/link";
import { AlertTriangle, Bell, ChevronRight } from "lucide-react";
import type { NotificationSummary } from "@/features/notifications/lib/notification-service";
import { useTranslation } from "../../../lib/i18n/provider";
import type { TranslationKey } from "../../../lib/i18n/en";
import { formatCount } from "../lib/shell-labels";

type AttentionVariant = "count" | "warning";

interface AttentionItem {
  key: string;
  label: string;
  href: string;
  variant: AttentionVariant;
}

export function NeedsAttentionCard({
  notifications,
  isChief,
  isHeadOfHouse,
}: {
  notifications: NotificationSummary;
  isChief: boolean;
  isHeadOfHouse: boolean;
}) {
  const { t } = useTranslation();
  const items: AttentionItem[] = [];

  const counted = (count: number, one: TranslationKey, other: TranslationKey) =>
    formatCount(t(count === 1 ? one : other), count);

  if (isChief && notifications.chief) {
    const {
      hasActiveCollector,
      hasActiveFund,
      pendingHeadlessMembers,
      singleHeadlessHouseId,
      deactivationStatus,
    } = notifications.chief;

    if (deactivationStatus) {
      items.push({
        key: "deactivation",
        label:
          deactivationStatus === "APPROVED"
            ? t("shell.attention.deactivationApproved")
            : t("shell.attention.deactivationPending"),
        href: "/village/deactivation",
        variant: "warning",
      });
    }

    // Pending members of houses with no head: only the Chief can decide.
    if (pendingHeadlessMembers > 0) {
      items.push({
        key: "pending-heads",
        label: counted(
          pendingHeadlessMembers,
          "shell.attention.membersOne",
          "shell.attention.membersOther",
        ),
        href: singleHeadlessHouseId
          ? `/village/houses/${singleHeadlessHouseId}`
          : "/village/houses",
        variant: "count",
      });
    }
    if (!hasActiveCollector) {
      items.push({
        key: "no-collector",
        label: t("shell.attention.noCollector"),
        href: "/village/collectors",
        variant: "warning",
      });
    }
    if (!hasActiveFund) {
      items.push({
        key: "no-fund",
        label: t("shell.attention.noFund"),
        href: "/village/funds",
        variant: "warning",
      });
    }
  }

  if (
    isHeadOfHouse &&
    notifications.headOfHouse &&
    notifications.headOfHouse.pendingMembers > 0
  ) {
    items.push({
      key: "pending-members",
      label: counted(
        notifications.headOfHouse.pendingMembers,
        "shell.attention.membersOne",
        "shell.attention.membersOther",
      ),
      href: "/village/household",
      variant: "count",
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-warning-border bg-warning-soft p-3 sm:p-4">
      <div className="flex items-center gap-2 text-warning-strong">
        <Bell aria-hidden className="size-5 shrink-0" />
        <h2 className="text-sm font-semibold">{t("shell.attention.title")}</h2>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              className="flex min-h-12 items-center gap-3 rounded-lg border border-warning-border bg-card px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
              href={item.href}
            >
              {item.variant === "warning" ? (
                <AlertTriangle
                  aria-hidden
                  className="size-4 shrink-0 text-warning-strong"
                />
              ) : null}
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-warning-strong">
                {t("shell.attention.view")}
                <ChevronRight aria-hidden className="size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
