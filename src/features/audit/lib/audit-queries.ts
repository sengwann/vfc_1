import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuditEntityType } from "@/lib/audit";
import { withChiefFundHistorySnapshot } from "@/features/fund-management/lib/fund-lifecycle-history";
import { AUDIT_PAGE_SIZE, type AuditFilters } from "./audit-filters";

export interface AuditLogListItem {
  id: string;
  actionType: AuditActionType;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
  actorName: string | null;
  fundId?: string | null;
}

export interface PlatformAuditLogListItem {
  id: string;
  actionType: AuditActionType;
  createdAt: Date;
  actorName: string | null;
  villageCode: string | null;
  villageName: string | null;
}

export interface AuditLogDetail {
  id: string;
  actionType: AuditActionType;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
  actorName: string | null;
  fundId?: string | null;
}

export interface PlatformAuditLogDetail extends AuditLogDetail {
  villageId: string | null;
  villageCode: string | null;
  villageName: string | null;
}

function buildWhereClause(
  base: Prisma.AuditLogWhereInput,
  filters: AuditFilters,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { ...base };
  if (filters.actionType) {
    where.actionType = filters.actionType;
  }
  if (filters.entityType) {
    where.entityType = filters.entityType;
  }
  // Fail closed even if a caller bypasses the page's validation recovery.
  if (!filters.dateRange.ok) throw new RangeError("Invalid audit date range.");
  const { gte, lt } = filters.dateRange;
  if (gte || lt) {
    where.createdAt = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
  }
  return where;
}

export async function getChiefAuditLogs(params: {
  villageId: string;
  filters: AuditFilters;
}): Promise<{ logs: AuditLogListItem[]; total: number; totalPages: number }> {
  const { villageId, filters } = params;
  const where = buildWhereClause({ villageId }, filters);
  const skip = (filters.page - 1) * AUDIT_PAGE_SIZE;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: AUDIT_PAGE_SIZE,
      skip,
      select: {
        id: true,
        actionType: true,
        entityType: true,
        entityId: true,
        fundId: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const logs: AuditLogListItem[] = rows.map((row) => ({
    id: row.id,
    actionType: row.actionType,
    entityType: row.entityType,
    entityId: row.entityId,
    fundId: row.fundId,
    createdAt: row.createdAt,
    actorName: row.actor?.name ?? null,
  }));

  return {
    logs,
    total,
    totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

export async function getPlatformAuditLogs(params: {
  filters: AuditFilters;
}): Promise<{
  logs: PlatformAuditLogListItem[];
  total: number;
  totalPages: number;
}> {
  const { filters } = params;
  const where = buildWhereClause(
    { entityType: AuditEntityType.VILLAGE },
    filters,
  );
  const skip = (filters.page - 1) * AUDIT_PAGE_SIZE;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: AUDIT_PAGE_SIZE,
      skip,
      select: {
        id: true,
        actionType: true,
        createdAt: true,
        metadata: true,
        actor: { select: { name: true } },
        village: { select: { villageCode: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const logs: PlatformAuditLogListItem[] = rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const metadataVillageCode =
      typeof metadata.villageCode === "string" ? metadata.villageCode : null;
    const metadataName =
      typeof metadata.name === "string" ? metadata.name : null;
    return {
      id: row.id,
      actionType: row.actionType,
      createdAt: row.createdAt,
      actorName: row.actor?.name ?? null,
      villageCode: row.village?.villageCode ?? metadataVillageCode,
      villageName: row.village?.name ?? metadataName,
    };
  });

  return {
    logs,
    total,
    totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

export async function getChiefAuditDetail(params: {
  auditId: string;
  villageId: string;
}): Promise<AuditLogDetail | null> {
  const { auditId, villageId } = params;
  const audit = await prisma.auditLog.findUnique({
    where: { id: auditId },
    select: {
      id: true,
      villageId: true,
      fundId: true,
      actionType: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  if (!audit || audit.villageId !== villageId) {
    return null;
  }
  return {
    fundId: audit.fundId,
    id: audit.id,
    actionType: audit.actionType,
    entityType: audit.entityType,
    entityId: audit.entityId,
    metadata: audit.metadata,
    createdAt: audit.createdAt,
    actorName: audit.actor?.name ?? null,
  };
}

export async function getPlatformAuditDetail(params: {
  auditId: string;
}): Promise<PlatformAuditLogDetail | null> {
  const { auditId } = params;
  const audit = await prisma.auditLog.findUnique({
    where: { id: auditId },
    select: {
      id: true,
      villageId: true,
      actionType: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true } },
      village: { select: { villageCode: true, name: true } },
    },
  });
  if (!audit || audit.entityType !== AuditEntityType.VILLAGE) {
    return null;
  }
  const metadata = (audit.metadata ?? {}) as Record<string, unknown>;
  return {
    id: audit.id,
    actionType: audit.actionType,
    entityType: audit.entityType,
    entityId: audit.entityId,
    metadata: audit.metadata,
    createdAt: audit.createdAt,
    actorName: audit.actor?.name ?? null,
    villageId: audit.villageId,
    villageCode:
      audit.village?.villageCode ??
      (typeof metadata.villageCode === "string" ? metadata.villageCode : null),
    villageName:
      audit.village?.name ??
      (typeof metadata.name === "string" ? metadata.name : null),
  };
}

/** Authenticated Fund scope is independent of all browser filters. */
export function getChiefFundAuditLogs(fundId: string, filters: AuditFilters) {
  return withChiefFundHistorySnapshot(fundId, async (tx, fund, villageId) => {
    if (!Number.isSafeInteger(filters.page) || filters.page < 1 || !Number.isSafeInteger((filters.page - 1) * AUDIT_PAGE_SIZE)) throw new RangeError("Invalid audit page.");
    const where: Prisma.AuditLogWhereInput = { AND: [{ villageId, fundId: fund.id }, buildWhereClause({}, filters)] };
    const [rows, total] = await Promise.all([
      tx.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: AUDIT_PAGE_SIZE, skip: (filters.page - 1) * AUDIT_PAGE_SIZE,
        select: { id: true, fundId: true, actionType: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } } }),
      tx.auditLog.count({ where }),
    ]);
    const logs: AuditLogListItem[] = rows.map((row) => ({ id: row.id, fundId: row.fundId, actionType: row.actionType, entityType: row.entityType, entityId: row.entityId, createdAt: row.createdAt, actorName: row.actor?.name ?? null }));
    return { fund: { id: fund.id, name: fund.name }, logs, total, totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
  });
}
