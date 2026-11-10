import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Invalidates the cached village layout so notification badges
 * and navigation are recomputed on the next render.
 * Call this inside any Server Action that mutates data
 * reflected in the notification badges.
 */
export function revalidateVillageShell(): void {
  revalidatePath("/village", "layout");
}
