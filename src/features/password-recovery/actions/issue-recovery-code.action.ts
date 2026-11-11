"use server";

import { revalidatePath } from "next/cache";

import { getClientIp } from "../../../lib/auth/client-ip";
import { isSerializationConflict } from "../../../lib/db/transaction";
import { issueRecoveryCode } from "../lib/password-recovery-service";
import { formatRecoveryCode } from "../lib/recovery-code";
import { requireRecoveryApprover } from "../lib/recovery-guard";
import { parseRecoveryRequestId } from "../lib/recovery-input";
import { ADMIN_RECOVERY_PATH, CHIEF_RECOVERY_PATH } from "../lib/recovery-paths";
import { issueErrorFor, type IssueFormState } from "../lib/recovery-results";
import { requestIsSameOrigin } from "../lib/same-origin";

/**
 * A Chief or System Admin issues (or re-issues) a one-time code for a request
 * that a member filed.
 *
 *  - Pending Request Gate: the form carries a REQUEST id, never a user id, and
 *    the service refuses anything that is not an open request this person may
 *    handle.
 *  - Step-up: the approver's own password is typed into this very form and
 *    checked here, every time.
 *
 * The code comes back as form state, shown once on the page. It is never put in
 * a URL, a redirect, a cookie, a log line or the audit log. The password is
 * never returned.
 */
export async function issueRecoveryCodeAction(
  _previous: IssueFormState,
  formData: FormData,
): Promise<IssueFormState> {
  const approver = await requireRecoveryApprover();

  if (!(await requestIsSameOrigin())) {
    return { status: "error", error: "invalid_request" };
  }

  const requestId = parseRecoveryRequestId(formData.get("requestId"));
  const password = formData.get("password");

  if (requestId === null) {
    return { status: "error", error: "invalid_request" };
  }

  if (typeof password !== "string" || password.length === 0) {
    return { status: "error", error: "password_required" };
  }

  try {
    const result = await issueRecoveryCode({
      requestId,
      actorUserId: approver.id,
      password,
      clientIp: await getClientIp(),
    });

    revalidatePath(
      approver.role === "SYSTEM_ADMIN" ? ADMIN_RECOVERY_PATH : CHIEF_RECOVERY_PATH,
    );

    if (result.kind !== "issued") {
      return { status: "error", error: issueErrorFor(result) };
    }

    return {
      status: "issued",
      code: formatRecoveryCode(result.code),
      codeExpiresAt: result.codeExpiresAt.toISOString(),
      reissued: result.reissued,
      requestId: result.requestId,
    };
  } catch (error) {
    if (!isSerializationConflict(error)) {
      console.error("Issuing a recovery code failed", error);
    }

    return { status: "error", error: "busy" };
  }
}
