import "server-only";
import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireActiveCollector, getCurrentPeriod } from "@/lib/authz";
import { requireReceiptAccess } from "@/features/receipt-viewing/lib/receipt-access";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { parseHistoryFilters, historyBaseQuery, type HistoryParams, type HistoryError } from "./history-filters";
import { decodeHistoryCursor, encodeHistoryCursor, type HistoryKind } from "./history-cursor";
import type { CashPaymentListItem } from "@/features/cash-payment/components/cash-payment-list";
import type { ReceiptListItem } from "@/features/receipt-viewing/components/receipt-list";

export type HistoryResult = Awaited<ReturnType<typeof readHistory>>;
export function getCashHistory(params: HistoryParams = {}) { return readHistory("cash", params); }
export function getReceiptHistory(params: HistoryParams = {}) { return readHistory("receipt", params); }

async function readHistory(kind: HistoryKind, params: HistoryParams) {
  const context = kind === "cash" ? await requireActiveCollector() : await requireReceiptAccess();
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== context.user.id) redirect(LOGIN_ROUTE);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const actor = await tx.user.findUnique({ where: { id: identity.userId }, select: {
      id: true, sessionVersion: true, mustChangePassword: true, role: true, membershipStatus: true,
      villageId: true, village: { select: { status: true } },
    } });
    if (!actor || actor.sessionVersion !== identity.sessionVersion) redirect(LOGIN_ROUTE);
    if (actor.mustChangePassword) redirect(CHANGE_PASSWORD_ROUTE);
    if (actor.role === "SYSTEM_ADMIN" || actor.membershipStatus !== "ACTIVE" || actor.villageId !== context.villageId || actor.village?.status !== "ACTIVE") redirectForbidden();
    const villageId = context.villageId;
    const period = getCurrentPeriod();
    const assignment = await tx.collectorAssignment.findFirst({ where: {
      userId: actor.id, villageId, year: period.year, month: period.month, isActive: true,
    }, select: { id: true } });
    if (kind === "cash" && !assignment) redirectForbidden();
    // Current authority is rederived inside this snapshot; a former Collector
    // becomes payer-only. No browser identity or preflight access-level is used.
    const scope: Prisma.PaymentWhereInput = kind === "cash" || actor.role === "CHIEF" ? { villageId }
      : assignment ? { villageId, OR: [{ collectorUserId: actor.id }, { payerUserId: actor.id }] }
        : { villageId, payerUserId: actor.id };
    const eligible: Prisma.PaymentWhereInput = kind === "receipt" ? { AND: [scope, { receipt: { isNot: null } }] } : scope;
    // Fund metadata only, never an unbounded payment/receipt history read.
    const funds = await tx.fund.findMany({ where: { villageId, payments: { some: eligible } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, name: true } });
    const accessLevel = actor.role === "CHIEF" ? "village" as const : assignment ? "collector" as const : "own" as const;
    const fail = (error: HistoryError) => ({ ok: false as const, error, funds, villageId, accessLevel });
    const filters = parseHistoryFilters(params);
    if (!filters.ok) return fail(filters.error);
    if (filters.fundId && !funds.some((fund) => fund.id === filters.fundId)) return fail("UNAVAILABLE");
    const paymentWhere: Prisma.PaymentWhereInput = { AND: [eligible,
      ...(filters.fundId ? [{ fundId: filters.fundId }] : []),
      ...(filters.status ? [{ status: filters.status }] : []),
      ...(filters.dateRange.gte || filters.dateRange.lt ? [{ createdAt: {
        ...(filters.dateRange.gte ? { gte: filters.dateRange.gte } : {}),
        ...(filters.dateRange.lt ? { lt: filters.dateRange.lt } : {}),
      } }] : []),
    ] };
    const receiptWhere: Prisma.ReceiptWhereInput = { villageId, payment: { is: paymentWhere } };
    let anchor: { id: string; time: Date } | undefined;
    if (filters.cursor) {
      const id = decodeHistoryCursor(kind, filters);
      if (!id) return fail("CURSOR");
      if (kind === "cash") {
        const row = await tx.payment.findFirst({ where: { AND: [paymentWhere, { id }] }, select: { id: true, createdAt: true } });
        if (row) anchor = { id: row.id, time: row.createdAt };
      } else {
        const row = await tx.receipt.findFirst({ where: { AND: [receiptWhere, { id }] }, select: { id: true, payment: { select: { createdAt: true } } } });
        if (row) anchor = { id: row.id, time: row.payment.createdAt };
      }
      if (!anchor) return fail("STALE");
    }
    const newer = filters.direction === "newer";
    const order = newer ? "asc" as const : "desc" as const;
    const size = kind === "cash" ? 20 : 50;
    let payments: CashPaymentListItem[] = [];
    let receipts: ReceiptListItem[] = [];
    if (kind === "cash") {
      payments = await tx.payment.findMany({ where: { AND: [paymentWhere, ...(anchor ? [{ OR: [
        { createdAt: (newer ? { gt: anchor.time } : { lt: anchor.time }) }, { createdAt: anchor.time, id: (newer ? { gt: anchor.id } : { lt: anchor.id }) },
      ] }] : [])] }, orderBy: [{ createdAt: order }, { id: order }], take: size + 1, select: {
        id: true, amount: true, status: true, createdAt: true, voidReason: true,
        assessment: { select: { houseNumberSnapshot: true } }, fund: { select: { status: true, name: true } }, payer: { select: { name: true } },
      } });
    } else {
      const rows = await tx.receipt.findMany({ where: { AND: [receiptWhere, ...(anchor ? [{ OR: [
        { payment: { is: { createdAt: (newer ? { gt: anchor.time } : { lt: anchor.time }) } } },
        { payment: { is: { createdAt: anchor.time } }, id: (newer ? { gt: anchor.id } : { lt: anchor.id }) },
      ] }] : [])] }, orderBy: [{ payment: { createdAt: order } }, { id: order }], take: size + 1, select: {
        id: true, receiptNumber: true, status: true, payment: { select: { id: true, amount: true, status: true, createdAt: true, fund: { select: { name: true } } } },
      } });
      for (const row of rows) {
        if ((row.status === "ACTIVE") !== (row.payment.status === "ACCEPTED")) throw new Error("Payment/receipt history integrity failure.");
      }
      receipts = rows.map((row) => ({ ...row, payment: { ...row.payment, paymentMethod: "CASH" } }));
    }
    const rows = kind === "cash" ? payments : receipts;
    const more = rows.length > size;
    const visible = rows.slice(0, size);
    if (newer) visible.reverse();
    // Each direction's lookahead establishes its own continuation; the anchor
    // establishes the opposite navigation. Concurrent removals may yield an
    // empty page; the UI always offers restart rather than guessing an anchor.
    const older = !newer ? more : Boolean(anchor);
    const previous = newer ? more : Boolean(anchor);
    return { ok: true as const, funds, villageId, accessLevel, baseQuery: historyBaseQuery(filters),
      payments: kind === "cash" ? visible as CashPaymentListItem[] : [],
      receipts: kind === "receipt" ? visible as ReceiptListItem[] : [],
      older: older && visible.length ? encodeHistoryCursor(kind, filters, visible[visible.length - 1].id) : null,
      newer: previous && visible.length ? encodeHistoryCursor(kind, filters, visible[0].id) : null,
    };
  }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 });
}
