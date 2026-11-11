import "server-only";
import { FundWriteError } from "./fund-write";

/** PostgreSQL DATE is a calendar label; UTC here encodes it without a local-zone shift. */
export function validateFundExtension(form: FormData) {
  const raw = form.get("newEndDate"), reason = form.get("reason");
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new FundWriteError("New end date is invalid.");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw || raw.startsWith("0000")) throw new FundWriteError("New end date is invalid.");
  if (typeof reason !== "string" || !reason.trim() || reason.includes("\0")) throw new FundWriteError("Extension reason is required.");
  return { newEndDate: date, reason: reason.trim() };
}
