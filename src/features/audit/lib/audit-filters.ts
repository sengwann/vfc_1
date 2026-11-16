import "server-only";
import { parseFinancialDateRange, type FinancialDateRange } from "@/lib/financial-date-range";
import { AuditActionType } from "@prisma/client";
import { AuditEntityType } from "@/lib/audit";

export const AUDIT_PAGE_SIZE = 25;
export const entityTypesByAction = {
  CREATE: ["USER", "TRANSACTION"],
  UPDATE: ["USER", "TRANSACTION"],
  DELETE: ["USER", "TRANSACTION"],
  LOGIN: ["USER"],
  LOGOUT: ["USER"],
  STATUS_CHANGE: ["USER", "TRANSACTION"],
};

export type SearchParams = Record<string, string | string[] | undefined>;

export const ACTION_TYPE_OPTIONS = Object.values(AuditActionType) as string[];
export const ENTITY_TYPE_OPTIONS = Object.values(AuditEntityType) as string[];

export interface AuditFilters {
  actionType: AuditActionType | null;
  entityType: AuditEntityType | null;
  dateRange: FinancialDateRange;
  page: number;
}

const VALID_ACTION_TYPES = new Set<string>(ACTION_TYPE_OPTIONS);
const VALID_ENTITY_TYPES = new Set<string>(ENTITY_TYPE_OPTIONS);

export async function resolveSearchParams(
  searchParams: unknown,
): Promise<SearchParams> {
  if (!searchParams) {
    return {};
  }
  const maybePromise = searchParams as { then?: unknown };
  if (typeof maybePromise.then === "function") {
    return await (searchParams as Promise<SearchParams>);
  }
  return searchParams as SearchParams;
}

export function getFirstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export async function extractRouteParam(
  rawParams: unknown,
  key: string,
): Promise<string> {
  if (!rawParams) {
    return "";
  }
  let params: SearchParams;
  const maybePromise = rawParams as { then?: unknown };
  if (typeof maybePromise.then === "function") {
    params = await (rawParams as Promise<SearchParams>);
  } else {
    params = rawParams as SearchParams;
  }
  return getFirstString(params[key]);
}

function parsePage(raw: string): number {
  const page = parseInt(raw, 10);
  if (Number.isNaN(page) || page < 1) {
    return 1;
  }
  return page;
}

export function parseAuditFilters(params: SearchParams): AuditFilters {
  const rawActionType = getFirstString(params.actionType);
  const rawEntityType = getFirstString(params.entityType);
  const rawPage = getFirstString(params.page);

  const actionType =
    rawActionType && VALID_ACTION_TYPES.has(rawActionType)
      ? (rawActionType as AuditActionType)
      : null;

  const entityType =
    rawEntityType && VALID_ENTITY_TYPES.has(rawEntityType)
      ? (rawEntityType as AuditEntityType)
      : null;

  return {
    actionType,
    entityType,
    dateRange: parseFinancialDateRange(params.dateFrom, params.dateTo),
    page: parsePage(rawPage || "1"),
  };
}
