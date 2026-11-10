"use client";

import { useActionState, useState } from "react";

import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Field, Input } from "../../../components/ui/field";
import type { TranslationKey } from "../../../lib/i18n/en";
import { useTranslation } from "../../../lib/i18n/provider";
import { formatYangonDateTime } from "../../../lib/utils";
import { issueRecoveryCodeAction } from "../actions/issue-recovery-code.action";
import type { IssueErrorCode, IssueFormState } from "../lib/recovery-results";

const INITIAL: IssueFormState = { status: "idle" };

const ERROR_KEYS: Record<IssueErrorCode, TranslationKey> = {
  invalid_request: "recovery.issue.err.invalid_request",
  password_required: "recovery.issue.err.password_required",
  bad_password: "recovery.issue.err.bad_password",
  throttled: "recovery.issue.err.throttled",
  not_found: "recovery.issue.err.not_found",
  expired: "recovery.issue.err.expired",
  wrong_state: "recovery.issue.err.wrong_state",
  not_eligible: "recovery.issue.err.not_eligible",
  self_action: "recovery.issue.err.self_action",
  rate_limited: "recovery.issue.err.rate_limited",
  busy: "recovery.issue.err.busy",
};

/*
 * Step-up form. The approver types their own password here, and the code
 * comes back in `state`: it lives only in this component's memory, is shown
 * once, and is gone when the page is left or reloaded (the server keeps only a
 * hash). It is never written to the URL or to storage.
 */
export function IssueCodeForm({
  requestId,
  reissue,
}: {
  requestId: string;
  reissue: boolean;
}) {
  const { t } = useTranslation();
  const [state, formAction, pending] = useActionState(
    issueRecoveryCodeAction,
    INITIAL,
  );
  const [copied, setCopied] = useState(false);

  if (state.status === "issued") {
    const expires = formatYangonDateTime(new Date(state.codeExpiresAt));

    return (
      <div className="space-y-3">
        <Alert tone="success" title={t("recovery.issue.codeTitle")}>
          {t("recovery.issue.codeBody").replace("{date}", expires)}
        </Alert>
        <p
          className="select-all rounded-lg border bg-muted px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest"
          translate="no"
        >
          {state.code}
        </p>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(state.code);
              setCopied(true);
            } catch {
              // Clipboard can be blocked; the code is selectable above.
            }
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? t("recovery.issue.copied") : t("recovery.issue.copy")}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input name="requestId" type="hidden" value={requestId} />

      {state.status === "error" ? (
        <Alert tone="danger">{t(ERROR_KEYS[state.error])}</Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {t("recovery.issue.confirm")}
      </p>

      <Field
        id={`password-${requestId}`}
        label={t("recovery.issue.password")}
        required
      >
        <Input
          autoComplete="current-password"
          name="password"
          required
          type="password"
        />
      </Field>

      <Button loading={pending} type="submit">
        {pending
          ? t("recovery.issue.submitting")
          : reissue
            ? t("recovery.issue.reissueTitle")
            : t("recovery.issue.submit")}
      </Button>
    </form>
  );
}
