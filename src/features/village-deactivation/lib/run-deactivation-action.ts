import "server-only";

import { redirect } from "next/navigation";

import { redirectForbidden } from "../../../lib/authz/authz.errors";
import { isSerializationConflict } from "../../../lib/db/transaction";
import { revalidateVillageShell } from "../../shell/lib/shell-revalidation";
import {
  DEACTIVATION_ERROR,
  resultPath,
  type DeactivationActionResult,
} from "./deactivation-results";

/*
 * Shared tail of the four deactivation server actions. The action files stay
 * thin: they authenticate (requireChief / requireSystemAdmin), parse the form,
 * call the service, and hand the result here. redirect() works by throwing, so
 * it is only called here, outside any transaction.
 *
 * A serialization conflict that is still failing after the retries answers with
 * ?error=busy, like run-lifecycle-action.ts. Any other error is rethrown.
 */
export async function runDeactivationAction(params: {
  /** Page the actor lands on. */
  basePath: string;
  /** Does the work and returns the result for the redirect. */
  perform: () => Promise<DeactivationActionResult>;
}): Promise<never> {
  let result: DeactivationActionResult;

  try {
    result = await params.perform();
  } catch (error) {
    if (!isSerializationConflict(error)) {
      throw error;
    }

    result = { type: "error", error: DEACTIVATION_ERROR.BUSY };
  }

  if (result.type === "forbidden") {
    return redirectForbidden();
  }

  if (result.type === "success") {
    // The village shell's notification badges may depend on request state.
    revalidateVillageShell();
  }

  redirect(resultPath(params.basePath, result));
}
