"use server";

import { requireSystemAdmin } from "../../../lib/authz";
import { parseDeactivationConfig } from "../lib/deactivation-config";
import {
  ADMIN_DEACTIVATION_PATH,
  inputErrorResult,
  rejectResult,
} from "../lib/deactivation-results";
import { parseRejectInput } from "../lib/deactivation-input";
import { runDeactivationAction } from "../lib/run-deactivation-action";
import { rejectDeactivationRequest } from "../lib/village-deactivation-service";

/**
 * A System Admin rejects a pending request. A reason is required. The village
 * stays active; the Chief can submit again after the configured cooldown.
 */
export async function rejectDeactivationRequestAction(
  formData: FormData,
): Promise<void> {
  const admin = await requireSystemAdmin();

  await runDeactivationAction({
    basePath: ADMIN_DEACTIVATION_PATH,
    perform: async () => {
      const input = parseRejectInput(formData);

      if (!input.ok) {
        return inputErrorResult(input.error);
      }

      return rejectResult(
        await rejectDeactivationRequest({
          requestId: input.requestId,
          actorUserId: admin.id,
          reason: input.reason,
          // A misconfigured cooldown throws here instead of silently changing it.
          cooldownMs: parseDeactivationConfig(process.env).rejectionCooldownMs,
        }),
      );
    },
  });
}
