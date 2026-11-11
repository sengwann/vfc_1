"use server";

import { getClientIp } from "../../../lib/auth/client-ip";
import { submitRecoveryRequest } from "../lib/password-recovery-service";
import { RECOVERY_RESPONSE_FLOOR_MS } from "../lib/recovery-config";
import { parseRecoveryRequestInput } from "../lib/recovery-input";
import type { RequestFormState } from "../lib/recovery-results";
import { withResponseFloor } from "../lib/recovery-timing";
import { requestIsSameOrigin } from "../lib/same-origin";

/**
 * The public "forgot password" form. Nobody is signed in, so there is nothing
 * to authorize; the protection is that the answer never depends on the account:
 * unknown, ineligible, duplicate and throttled requests all get the same
 * "submitted" answer, after the same minimum time. Only a malformed form (which
 * says nothing about any account) gets a different one.
 */
export async function requestPasswordRecoveryAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  if (!(await requestIsSameOrigin())) {
    return { status: "invalid" };
  }

  const parsed = parseRecoveryRequestInput({
    villageCode: formData.get("villageCode"),
    identifier: formData.get("identifier"),
  });

  if (!parsed.ok) {
    return { status: "invalid" };
  }

  const clientIp = await getClientIp();

  return withResponseFloor(RECOVERY_RESPONSE_FLOOR_MS, async () => {
    try {
      await submitRecoveryRequest({ input: parsed.data, clientIp });
    } catch (error) {
      // A failure must not change what the visitor sees. Log the error only.
      console.error("Password recovery request failed", error);
    }

    return { status: "submitted" } as const;
  });
}
