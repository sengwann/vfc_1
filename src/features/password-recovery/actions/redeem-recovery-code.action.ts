"use server";

import { redirect } from "next/navigation";

import { LOGIN_ROUTE } from "../../../lib/auth/auth.constants";
import { getClientIp } from "../../../lib/auth/client-ip";
import { isSerializationConflict } from "../../../lib/db/transaction";
import { redeemRecoveryCode } from "../lib/password-recovery-service";
import { RECOVERY_RESPONSE_FLOOR_MS } from "../lib/recovery-config";
import { normalizeRecoveryCodeInput } from "../lib/recovery-code";
import { parseRecoveryRequestInput } from "../lib/recovery-input";
import { RESET_DONE_PARAM } from "../lib/recovery-paths";
import {
  redeemErrorFor,
  type RedeemFormState,
} from "../lib/recovery-results";
import { withResponseFloor } from "../lib/recovery-timing";
import { requestIsSameOrigin } from "../lib/same-origin";

/**
 * The member enters the code from their Chief and chooses a new password.
 * Wrong code, no code, expired, revoked and unknown account all answer
 * "invalid_code" after the same minimum time. A malformed code is answered the
 * same way, so its format is not an oracle either.
 *
 * Neither the code nor the password is ever put into the returned state.
 */
export async function redeemRecoveryCodeAction(
  _previous: RedeemFormState,
  formData: FormData,
): Promise<RedeemFormState> {
  if (!(await requestIsSameOrigin())) {
    return { status: "error", error: "invalid_input" };
  }

  const parsed = parseRecoveryRequestInput({
    villageCode: formData.get("villageCode"),
    identifier: formData.get("identifier"),
  });
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (
    !parsed.ok ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return { status: "error", error: "invalid_input" };
  }

  if (newPassword !== confirmPassword) {
    return { status: "error", error: "password_mismatch" };
  }

  const clientIp = await getClientIp();
  const code = normalizeRecoveryCodeInput(formData.get("code"));

  const result = await withResponseFloor(
    RECOVERY_RESPONSE_FLOOR_MS,
    async (): Promise<
      | { done: true }
      | { done: false; state: RedeemFormState }
    > => {
      try {
        if (code === null) {
          return { done: false, state: { status: "error", error: "invalid_code" } };
        }

        const outcome = await redeemRecoveryCode({
          input: parsed.data,
          code,
          newPassword,
          clientIp,
        });

        if (outcome.kind === "completed") {
          return { done: true };
        }

        return {
          done: false,
          state: { status: "error", error: redeemErrorFor(outcome) },
        };
      } catch (error) {
        if (isSerializationConflict(error)) {
          return { done: false, state: { status: "error", error: "busy" } };
        }

        console.error("Password recovery redeem failed", error);
        return { done: false, state: { status: "error", error: "busy" } };
      }
    },
  );

  if (result.done) {
    // redirect() works by throwing, so it is called outside the try above.
    redirect(`${LOGIN_ROUTE}?${RESET_DONE_PARAM}=1`);
  }

  return result.state;
}
