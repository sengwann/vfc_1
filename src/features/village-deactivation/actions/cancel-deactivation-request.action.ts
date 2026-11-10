"use server";

import { requireChief } from "../../../lib/authz";
import {
  CHIEF_DEACTIVATION_PATH,
  cancelResult,
  inputErrorResult,
} from "../lib/deactivation-results";
import { parseCancelInput } from "../lib/deactivation-input";
import { runDeactivationAction } from "../lib/run-deactivation-action";
import { cancelDeactivationRequest } from "../lib/village-deactivation-service";

/**
 * The Chief cancels an approved request before its deadline. It needs a reason
 * and an explicit confirmation. This works while the village is read-only; that
 * is the whole point of the cancel action.
 */
export async function cancelDeactivationRequestAction(
  formData: FormData,
): Promise<void> {
  const { user, villageId } = await requireChief();

  await runDeactivationAction({
    basePath: CHIEF_DEACTIVATION_PATH,
    perform: async () => {
      const input = parseCancelInput(formData);

      if (!input.ok) {
        return inputErrorResult(input.error);
      }

      return cancelResult(
        await cancelDeactivationRequest({
          requestId: input.requestId,
          actorUserId: user.id,
          villageId,
          reason: input.reason,
        }),
      );
    },
  });
}
