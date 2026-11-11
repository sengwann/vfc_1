"use server";

import { requireSystemAdmin } from "../../../lib/authz";
import { runVillageLifecycleAction } from "../lib/run-lifecycle-action";

export async function suspendVillageAction(formData: FormData): Promise<void> {
  const admin = await requireSystemAdmin();

  await runVillageLifecycleAction({
    action: "suspend",
    formData,
    actorUserId: admin.id,
  });
}
