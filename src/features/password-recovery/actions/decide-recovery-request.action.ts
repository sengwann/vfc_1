"use server";

import { redirect } from "next/navigation";

import { isSerializationConflict } from "../../../lib/db/transaction";
import {
  rejectRecoveryRequest,
  withdrawRecoveryCode,
} from "../lib/password-recovery-service";
import { requireRecoveryApprover } from "../lib/recovery-guard";
import { parseRecoveryRequestId } from "../lib/recovery-input";
import {
  ADMIN_RECOVERY_PATH,
  CHIEF_RECOVERY_PATH,
  RECOVERY_ERROR_PARAM,
  RECOVERY_NOTICE_PARAM,
} from "../lib/recovery-paths";
import {
  decisionRedirect,
  type RecoveryRedirectCode,
} from "../lib/recovery-results";
import { requestIsSameOrigin } from "../lib/same-origin";

type Decision = "reject" | "withdraw";

async function decide(decision: Decision, formData: FormData): Promise<never> {
  const approver = await requireRecoveryApprover();
  const basePath =
    approver.role === "SYSTEM_ADMIN" ? ADMIN_RECOVERY_PATH : CHIEF_RECOVERY_PATH;

  let target: { kind: "notice" | "error"; code: RecoveryRedirectCode };

  const requestId = parseRecoveryRequestId(formData.get("requestId"));

  if (!(await requestIsSameOrigin()) || requestId === null) {
    target = { kind: "error", code: "invalid_request" };
  } else {
    try {
      const params = {
        requestId,
        actorUserId: approver.id,
        note: formData.get("note"),
      };

      target = decisionRedirect(
        decision === "reject"
          ? await rejectRecoveryRequest(params)
          : await withdrawRecoveryCode(params),
      );
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }

      target = { kind: "error", code: "busy" };
    }
  }

  const query = new URLSearchParams({
    [target.kind === "notice" ? RECOVERY_NOTICE_PARAM : RECOVERY_ERROR_PARAM]:
      target.code,
  });

  // redirect() works by throwing, so it stays outside the try above.
  return redirect(`${basePath}?${query.toString()}`);
}

/** Rejects a PENDING request. The note is optional and is shown to the member. */
export async function rejectRecoveryRequestAction(
  formData: FormData,
): Promise<void> {
  await decide("reject", formData);
}

/** Withdraws a live code. The note is required. */
export async function withdrawRecoveryCodeAction(
  formData: FormData,
): Promise<void> {
  await decide("withdraw", formData);
}
