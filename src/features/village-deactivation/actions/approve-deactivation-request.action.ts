"use server";

import { requireSystemAdmin } from "../../../lib/authz";
import {
  ADMIN_DEACTIVATION_PATH,
  approveResult,
  inputErrorResult,
} from "../lib/deactivation-results";
import { parseApproveInput } from "../lib/deactivation-input";
import { runDeactivationAction } from "../lib/run-deactivation-action";
import { approveDeactivationRequest } from "../lib/village-deactivation-service";

/** A System Admin approves a pending request: read-only mode and the 24h countdown start. */
export async function approveDeactivationRequestAction(
  formData: FormData,
): Promise<void> {
  const admin = await requireSystemAdmin();

  await runDeactivationAction({
    basePath: ADMIN_DEACTIVATION_PATH,
    perform: async () => {
      const input = parseApproveInput(formData);

      if (!input.ok) {
        return inputErrorResult(input.error);
      }

      return approveResult(
        await approveDeactivationRequest({
          requestId: input.requestId,
          actorUserId: admin.id,
        }),
      );
    },
  });
}
