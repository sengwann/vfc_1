"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import { Clock, Users } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Field, Select } from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import { cn } from "../../../lib/utils";
import { submitRejoinRequestAction } from "../actions/submit-rejoin-request.action";

/** One of the two possible outcomes of a request, shown before submitting. */
function OutcomeItem({
  icon,
  tone,
  title,
  body,
}: {
  icon: ReactNode;
  tone: "info" | "success";
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4",
          tone === "info"
            ? "border-info-border bg-info-soft text-info-strong"
            : "border-success-border bg-success-soft text-success-strong",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
          {title}
        </p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {body}
        </p>
      </div>
    </li>
  );
}

export function RejoinForm({
  houses,
}: {
  houses: {
    houseNumber: string;
  }[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [isPending, startTransition] = useTransition();
  const [houseError, setHouseError] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      await submitRejoinRequestAction(formData);
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <Field
        error={houseError ? t("rejoin.houseRequired") : undefined}
        id="houseNumber"
        label={t("rejoin.houseLabel")}
        required
      >
        <Select
          defaultValue=""
          disabled={isPending}
          name="houseNumber"
          onChange={() => setHouseError(false)}
          onInvalid={(event) => {
            // Same native `required` rule as before; only the message is restyled.
            event.preventDefault();
            setHouseError(true);
            selectRef.current?.focus();
          }}
          ref={selectRef}
          required
        >
          <option disabled value="">
            {t("rejoin.housePlaceholder")}
          </option>
          {houses.map((house) => (
            <option key={house.houseNumber} value={house.houseNumber}>
              {house.houseNumber}
            </option>
          ))}
        </Select>
      </Field>

      <section aria-labelledby="rejoin-next-heading" className="space-y-2.5">
        <h3
          className="text-sm font-semibold text-foreground"
          id="rejoin-next-heading"
        >
          {t("rejoin.nextTitle")}
        </h3>
        <ul className="space-y-2">
          {/* Both outcomes are now pending: a head approves, or the Village
              Chief decides when the house has no head yet. */}
          <OutcomeItem
            body={t("rejoin.nextHasMembersBody")}
            icon={<Clock />}
            title={t("rejoin.nextHasMembersTitle")}
            tone="info"
          />
          <OutcomeItem
            body={t("rejoin.nextEmptyBody")}
            icon={<Users />}
            title={t("rejoin.nextEmptyTitle")}
            tone="info"
          />
        </ul>
      </section>

      <Button className="w-full" loading={isPending} size="lg" type="submit">
        {isPending ? t("rejoin.submitting") : t("rejoin.submit")}
      </Button>
    </form>
  );
}
