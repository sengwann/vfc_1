import { createHash } from "node:crypto";
import { historyBaseQuery, type ValidHistoryFilters } from "./history-filters";
export type HistoryKind = "cash" | "receipt";
function binding(kind: HistoryKind, filters: ValidHistoryFilters) {
  return createHash("sha256").update(`${kind}:${historyBaseQuery(filters)}`).digest("hex");
}
/** Navigation hints only, not signed authority. Anchor identity/time is resolved
 * again from the authorized filtered snapshot on every request. */
export function encodeHistoryCursor(kind: HistoryKind, filters: ValidHistoryFilters, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, id, binding: binding(kind, filters) })).toString("base64url");
}
export function decodeHistoryCursor(kind: HistoryKind, filters: ValidHistoryFilters): string | null {
  if (!filters.cursor || filters.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(filters.cursor)) return null;
  try {
    const value = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
    if (!value || value.v !== 1 || typeof value.id !== "string" || !value.id || value.id.length > 128 || /[\s\x00-\x1f]/.test(value.id) ||
        value.binding !== binding(kind, filters) || Object.keys(value).sort().join(",") !== "binding,id,v") return null;
    return value.id as string;
  } catch { return null; }
}
