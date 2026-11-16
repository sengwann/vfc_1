import "server-only";
import type { Prisma } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireChief } from "@/lib/authz";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";

/** Read authority only: never acquires financial write locks. */
export async function withChiefFundHistorySnapshot<T>(fundId: string, read: (
  tx: Prisma.TransactionClient, fund: Prisma.FundGetPayload<{ include: { closedBy: { select: { id: true; name: true } } } }>, villageId: string,
) => Promise<T>): Promise<T> {
  const context = await requireChief();
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== context.user.id) redirect(LOGIN_ROUTE);
  if (!fundId.trim() || fundId.length > 128 || fundId.includes("\0")) notFound();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const actor = await tx.user.findUnique({ where: { id: identity.userId }, select: {
      sessionVersion: true, mustChangePassword: true, role: true, membershipStatus: true,
      villageId: true, village: { select: { status: true } },
    } });
    if (!actor || actor.sessionVersion !== identity.sessionVersion) redirect(LOGIN_ROUTE);
    if (actor.mustChangePassword) redirect(CHANGE_PASSWORD_ROUTE);
    if (actor.role !== "CHIEF" || actor.membershipStatus !== "ACTIVE" || actor.villageId !== context.villageId || actor.village?.status !== "ACTIVE") redirectForbidden();
    const fund = await tx.fund.findFirst({ where: { id: fundId, villageId: context.villageId }, include: { closedBy: { select: { id: true, name: true } } } });
    if (!fund) notFound();
    return read(tx, fund, context.villageId);
  }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 });
}

const SIZE = 20;
/** The cursor carries only an extension ID; its scope and tuple are read anew. */
export function getChiefFundLifecycleHistory(fundId: string, before?: string | string[]) {
  return withChiefFundHistorySnapshot(fundId, async (tx, fund, villageId) => {
    const scope = { fundId, villageId };
    let anchor: { newTermsVersion: number; id: string } | null = null;
    let stale = false;
    if (before !== undefined) {
      if (typeof before !== "string" || !before || before.length > 128 || before.includes("\0")) stale = true;
      else {
        anchor = await tx.fundEndDateExtension.findFirst({ where: { ...scope, id: before }, select: { newTermsVersion: true, id: true } });
        stale = !anchor;
      }
    }
    const rows = stale ? [] : await tx.fundEndDateExtension.findMany({ where: { AND: [scope, ...(anchor ? [{ OR: [
      { newTermsVersion: { lt: anchor.newTermsVersion } }, { newTermsVersion: anchor.newTermsVersion, id: { lt: anchor.id } },
    ] }] : [])] }, orderBy: [{ newTermsVersion: "desc" }, { id: "desc" }], take: SIZE + 1,
      include: { changedBy: { select: { id: true, name: true } } } });
    const visible = rows.slice(0, SIZE);
    // Audit evidence is bounded independently from lifecycle facts. Overflow is
    // explicitly uncertain, never interpreted as missing or successful evidence.
    const evidence = await tx.auditLog.findMany({ where: { AND: [scope, { OR: [
      { entityType: "FUND_END_DATE_EXTENSION", entityId: { in: visible.map((row) => row.id) } },
      ...(fund.status === "CLOSED" ? [{ entityType: "FUND", entityId: fund.id, metadata: { path: ["event"], equals: "FUND_CLOSED" } }] : []),
    ] }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 201,
      select: { entityId: true, entityType: true, actionType: true, actorUserId: true, metadata: true } });
    const overflow = evidence.length > 200;
    const metadata = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const extensions = visible.map((row) => {
      const matches = evidence.filter((log) => log.entityId === row.id && log.entityType === "FUND_END_DATE_EXTENSION");
      const log = matches[0]; const data = metadata(log?.metadata);
      const evidenceWarning = overflow || matches.length !== 1 || log.actionType !== "UPDATE" || log.actorUserId !== row.changedByUserId ||
        data.event !== "FUND_EXTENDED" || data.extensionId !== row.id || data.termsVersion !== row.newTermsVersion ||
        data.previousEndDate !== row.previousEndDate.toISOString().slice(0, 10) || data.newEndDate !== row.newEndDate.toISOString().slice(0, 10) || data.reason !== row.reason;
      return { id: row.id, previousEndDate: row.previousEndDate.toISOString(), newEndDate: row.newEndDate.toISOString(), previousTermsVersion: row.previousTermsVersion,
        newTermsVersion: row.newTermsVersion, actorName: row.changedBy?.name ?? null, changedAt: row.changedAt.toISOString(), reason: row.reason, evidenceWarning };
    });
    const closedLogs = evidence.filter((log) => log.entityType === "FUND" && log.entityId === fund.id);
    const closed = closedLogs[0]; const closeData = metadata(closed?.metadata);
    const closureWarning = fund.status === "CLOSED" && (overflow || !fund.closedAt || !fund.closedByUserId || closedLogs.length !== 1 ||
      closed.actionType !== "STATUS_CHANGE" || closed.actorUserId !== fund.closedByUserId || closeData.event !== "FUND_CLOSED" ||
      closeData.closedAt !== fund.closedAt.toISOString() || closeData.termsVersion !== fund.termsVersion);
    return { fund, extensions, stale, closureWarning, older: rows.length > SIZE ? visible[visible.length - 1].id : null };
  });
}
export type FundLifecycleHistory = Awaited<ReturnType<typeof getChiefFundLifecycleHistory>>;
