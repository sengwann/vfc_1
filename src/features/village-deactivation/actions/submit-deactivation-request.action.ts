"use server";

import { requireChief } from "../../../lib/authz";
import {
  CHIEF_DEACTIVATION_PATH,
  inputErrorResult,
  submitResult,
} from "../lib/deactivation-results";
import { parseSubmitRequestInput } from "../lib/deactivation-input";
import { runDeactivationAction } from "../lib/run-deactivation-action";
import { submitDeactivationRequest } from "../lib/village-deactivation-service";

/**
 * The Chief asks for the village to be deactivated. The village comes from the
 * session, never from the form. Nothing changes for the village until a System
 * Admin approves.
 */
export async function submitDeactivationRequestAction(
  formData: FormData,
): Promise<void> {
  const { user, villageId } = await requireChief();

  await runDeactivationAction({
    basePath: CHIEF_DEACTIVATION_PATH,
    perform: async () => {
      const input = parseSubmitRequestInput(formData);

      if (!input.ok) {
        return inputErrorResult(input.error);
      }

      return submitResult(
        await submitDeactivationRequest({
          actorUserId: user.id,
          villageId,
          reason: input.reason,
        }),
      );
    },
  });
}
