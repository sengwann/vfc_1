"use server";

import { requireSystemAdmin } from "../../../lib/authz";
import { runVillageLifecycleAction } from "../lib/run-lifecycle-action";

export async function reactivateVillageAction(
  formData: FormData,
): Promise<void> {
  const admin = await requireSystemAdmin();

  await runVillageLifecycleAction({
    action: "reactivate",
    formData,
    actorUserId: admin.id,
  });
}
