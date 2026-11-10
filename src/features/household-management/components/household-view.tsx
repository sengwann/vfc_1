"use client";

import type { ReactNode } from "react";
import type { MembershipStatus } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/en";
import { MembershipStatusBadge } from "./membership-status-badge";

export interface HouseholdMemberView {
  id: string;
  name: string;
  role: string;
  membershipStatus: MembershipStatus;
}

/** Same shape the forms already used: <form action={serverAction}>. */
type FormAction = (formData: FormData) => void | Promise<void>;

interface HouseholdViewProps {
  houseNumber: string;
  headOfHouseId: string | null;
  currentHeadName: string | null;
  pendingMembers: HouseholdMemberView[];
  activeMembers: HouseholdMemberView[];
  historicalMembers: HouseholdMemberView[];
  changeHeadCandidates: HouseholdMemberView[];
  approveAction: FormAction;
  rejectAction: FormAction;
  removeAction: FormAction;
  changeHeadAction: FormAction;
}

const ROLE_KEYS: Record<string, TranslationKey> = {
  SYSTEM_ADMIN: "shell.role.systemAdmin",
  CHIEF: "shell.role.chief",
  VILLAGER: "shell.role.villager",
};

function fill(text: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    text,
  );
}

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}

function MemberIdentity({
  member,
  isHead = false,
  trailing,
}: {
  member: HouseholdMemberView;
  isHead?: boolean;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const roleKey = ROLE_KEYS[member.role];
  const roleLabel = roleKey ? t(roleKey) : member.role;

  return (
    <div className="flex items-start gap-3">
      <div
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
      >
        {initialOf(member.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{member.name}</p>
        <p className="text-sm text-muted-foreground">{roleLabel}</p>
        {isHead ? (
          <Badge className="mt-1.5" variant="info">
            {t("household.headBadge")}
          </Badge>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

/*
 * Two-step confirmation without client state: a native <details>. The summary
 * is styled as a button; opening it reveals the explanation and the real
 * submit button. Hidden input + server action are exactly as before.
 */
function ConfirmAction({
  action,
  memberId,
  triggerLabel,
  confirmLabel,
  body,
}: {
  action: FormAction;
  memberId: string;
  triggerLabel: string;
  confirmLabel: string;
  body: string;
}) {
  return (
    <details className="group">
      <summary
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full cursor-pointer list-none border-danger-border text-danger-strong hover:bg-danger-soft [&::-webkit-details-marker]:hidden",
        )}
      >
        {triggerLabel}
      </summary>
      <div className="mt-2 space-y-3 rounded-lg border border-danger-border bg-danger-soft/60 p-3 text-sm text-danger-strong">
        <p className="leading-relaxed">{body}</p>
        <form action={action}>
          <input name="memberId" type="hidden" value={memberId} />
          <Button className="w-full" type="submit" variant="destructive">
            {confirmLabel}
          </Button>
        </form>
      </div>
    </details>
  );
}

function StatTile({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-3 sm:p-4", className)} variant="muted">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold leading-snug">{value}</dd>
    </Card>
  );
}

export function HouseholdView({
  houseNumber,
  headOfHouseId,
  currentHeadName,
  pendingMembers,
  activeMembers,
  historicalMembers,
  changeHeadCandidates,
  approveAction,
  rejectAction,
  removeAction,
  changeHeadAction,
}: HouseholdViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <PageHeader
        description={fill(t("household.description"), {
          number: houseNumber,
        })}
        title={t("household.title")}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          className="col-span-2 sm:col-span-1"
          label={t("household.stat.head")}
          value={currentHeadName ?? t("household.stat.noHead")}
        />
        <StatTile
          label={t("household.stat.active")}
          value={activeMembers.length}
        />
        <StatTile
          label={t("household.stat.pending")}
          value={pendingMembers.length}
        />
      </dl>

      {/* Pending requests */}
      <Section
        actions={
          pendingMembers.length > 0 ? (
            <Badge variant="warning">{pendingMembers.length}</Badge>
          ) : null
        }
        description={t("household.pending.desc")}
        id="pending"
        title={t("household.pending.title")}
      >
        {pendingMembers.length === 0 ? (
          <EmptyState
            description={t("household.pending.emptyBody")}
            title={t("household.pending.emptyTitle")}
          />
        ) : (
          <ul className="space-y-3">
            {pendingMembers.map((member) => (
              <li key={member.id}>
                <Card className="border-warning-border">
                  <CardContent className="space-y-4">
                    <MemberIdentity
                      member={member}
                      trailing={
                        <MembershipStatusBadge
                          status={member.membershipStatus}
                        />
                      }
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <form action={approveAction}>
                        <input
                          name="memberId"
                          type="hidden"
                          value={member.id}
                        />
                        <Button className="w-full" type="submit">
                          {t("household.approve")}
                        </Button>
                      </form>
                      <ConfirmAction
                        action={rejectAction}
                        body={fill(t("household.reject.confirmBody"), {
                          name: member.name,
                        })}
                        confirmLabel={t("household.reject.confirm")}
                        memberId={member.id}
                        triggerLabel={t("household.reject")}
                      />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Active members */}
      <Section
        description={t("household.active.desc")}
        id="active"
        title={t("household.active.title")}
      >
        {activeMembers.length === 0 ? (
          <EmptyState
            description={t("household.active.emptyBody")}
            title={t("household.active.emptyTitle")}
          />
        ) : (
          <ul className="space-y-3">
            {activeMembers.map((member) => {
              const isHead = member.id === headOfHouseId;

              return (
                <li key={member.id}>
                  <Card>
                    <CardContent className="space-y-4">
                      <MemberIdentity
                        isHead={isHead}
                        member={member}
                        trailing={
                          <MembershipStatusBadge
                            status={member.membershipStatus}
                          />
                        }
                      />
                      {isHead ? (
                        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                          {t("household.headNote")}
                        </p>
                      ) : (
                        <ConfirmAction
                          action={removeAction}
                          body={fill(t("household.remove.confirmBody"), {
                            name: member.name,
                          })}
                          confirmLabel={t("household.remove.confirm")}
                          memberId={member.id}
                          triggerLabel={t("household.remove")}
                        />
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Change head */}
      <Section
        description={t("household.changeHead.desc")}
        id="change-head"
        title={t("household.changeHead.title")}
      >
        {changeHeadCandidates.length === 0 ? (
          <EmptyState
            description={t("household.changeHead.emptyBody")}
            title={t("household.changeHead.emptyTitle")}
          />
        ) : (
          <Card>
            <CardContent>
              <form action={changeHeadAction} className="space-y-4">
                <Field
                  id="targetUserId"
                  label={t("household.changeHead.label")}
                  required
                >
                  <Select defaultValue="" name="targetUserId" required>
                    <option disabled value="">
                      {t("household.changeHead.placeholder")}
                    </option>
                    {changeHeadCandidates.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Alert tone="warning">{t("household.changeHead.note")}</Alert>

                <Button className="w-full sm:w-auto" type="submit">
                  {t("household.changeHead.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </Section>

      {/* History (collapsed: reference only) */}
      <section aria-labelledby="history-heading">
        <Card variant="muted">
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
              <h2
                className="text-base font-semibold leading-snug"
                id="history-heading"
              >
                {t("household.history.title")}
              </h2>
              <Badge variant="neutral">{historicalMembers.length}</Badge>
            </summary>
            <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
              {historicalMembers.length === 0 ? (
                <EmptyState
                  description={t("household.history.emptyBody")}
                  title={t("household.history.emptyTitle")}
                />
              ) : (
                <ul className="space-y-3">
                  {historicalMembers.map((member) => (
                    <li key={member.id}>
                      <Card className="p-3">
                        <MemberIdentity
                          member={member}
                          trailing={
                            <MembershipStatusBadge
                              status={member.membershipStatus}
                            />
                          }
                        />
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground">
                {t("household.history.note")}
              </p>
            </div>
          </details>
        </Card>
      </section>
    </div>
  );
}
